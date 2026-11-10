import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { SpeechLifecycle, type SpeechLifecycleSnapshot } from '../src/speech_lifecycle';
import { LocalSynthesisClient, type LocalListener, type WorkerLike } from '../src/speech_local_client';
import { SpeechWorkerHost } from '../src/speech_worker_host';
import type { SpeechEngine, SpeechTokens } from '../src/speech_synthesis';
import type { GpuCapabilityResult } from '../src/speech_gpu_capability';
import type { GpuLaunchCapability } from '../src/speech_gpu_client';

function engine(): Promise<SpeechEngine<SpeechTokens>> {
  return Promise.resolve({
    phonemize: () => Promise.resolve('a'),
    tokenize: () => ({ dims: [1, 5] }),
    generate: () => Promise.resolve({ samples: new Float32Array(1000).fill(0.2), rate: 24_000 }),
  });
}

class PhysicalWorker implements WorkerLike {
  alive = true;
  readonly terminate = vi.fn(() => Promise.resolve(0));
  private readonly listeners = new Map<string, (value: unknown) => void>();
  private readonly host = new SpeechWorkerHost(engine, (message) => {
    queueMicrotask(() => {
      this.listeners.get('message')?.(structuredClone(message));
    });
  });
  constructor(readonly backend: 'cpu' | 'gpu') {}
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  postMessage(value: unknown): void {
    queueMicrotask(() => {
      void this.host.receive(structuredClone(value));
    });
  }
  exit(): void {
    this.alive = false;
    this.listeners.get('exit')?.(0);
  }
  stale(value: unknown): void {
    this.listeners.get('message')?.(value);
  }
}

interface Observation {
  snapshot: SpeechLifecycleSnapshot;
  workers: Array<{ backend: 'cpu' | 'gpu'; state: string }>;
  proof: boolean;
}

function harness(mode: 'cpu' | 'gpu') {
  const observations: Observation[] = [];
  const clients: Array<{ worker: PhysicalWorker; client: LocalSynthesisClient }> = [];
  const capability = mock<GpuLaunchCapability>({ modelDirectory: '/gpu' });
  let proofActive = false;
  let proof: PromiseWithResolvers<GpuCapabilityResult> | undefined;
  let proofSignal: AbortSignal | undefined;
  let proofCount = 0;
  function client(backend: 'cpu' | 'gpu', listener: LocalListener): LocalSynthesisClient {
    const instance = new LocalSynthesisClient({
      listener,
      spawn: () => {
        expect(proofActive).toBe(false);
        expect(clients.filter(({ worker }) => worker.alive)).toHaveLength(0);
        const worker = new PhysicalWorker(backend);
        clients.push({ worker, client: instance });
        return worker;
      },
    });
    return instance;
  }
  const manager = new SpeechLifecycle({
    requestedMode: mode,
    resolveCpu: () => Promise.resolve('/cpu'),
    proveGpu: (signal) => {
      expect(proofActive).toBe(false);
      expect(clients.filter(({ worker }) => worker.alive)).toHaveLength(0);
      proofActive = true;
      proofSignal = signal;
      proofCount++;
      proof = Promise.withResolvers<GpuCapabilityResult>();
      return proof.promise;
    },
    createCpu: (listener) => client('cpu', listener),
    createGpu: (value, listener) => {
      expect(value).toBe(capability);
      return client('gpu', listener);
    },
    changed: (snapshot) => {
      observations.push({
        snapshot,
        proof: proofActive,
        workers: clients
          .filter(({ worker }) => worker.alive)
          .map(({ worker, client: active }) => ({ backend: worker.backend, state: active.state() })),
      });
    },
  });
  function closeProof(success: boolean): void {
    expect(proofActive).toBe(true);
    proofActive = false;
    proof?.resolve(success ? { check: { phase: 'ready' }, capability } : { check: { phase: 'unavailable', reason: 'no_hardware' } });
  }
  function verify(): void {
    for (const { snapshot, workers, proof: active } of observations) {
      expect(workers.length + Number(active)).toBeLessThanOrEqual(1);
      if (snapshot.phase === 'ready') {
        expect(workers).toEqual([{ backend: snapshot.actualBackend, state: 'ready' }]);
      }
      if (snapshot.actualBackend !== 'none') expect(snapshot.phase).toBe('ready');
      if (snapshot.phase === 'cold' || snapshot.phase === 'disposed') {
        expect(workers).toHaveLength(0);
        expect(active).toBe(false);
      }
    }
  }
  return { manager, clients, observations, closeProof, verify, proofSignal: () => proofSignal, proofCount: () => proofCount };
}

it('ResourceTrace: CPU to GPU to CPU keeps retirement ownership until exit and fences stale callbacks', async () => {
  const h = harness('cpu');
  const signal = new AbortController().signal;
  expect((await h.manager.acquire(1, signal)).status).toBe('ready');
  h.manager.release(1);
  const cpu = h.clients[0]?.worker;
  h.manager.select('gpu');
  expect(h.manager.snapshot()).toMatchObject({ phase: 'retiring', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  expect(cpu?.alive).toBe(true);
  const gpu = h.manager.acquire(2, signal);
  expect(h.proofCount()).toBe(0);
  cpu?.exit();
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(1);
    },
    { interval: 5 },
  );
  h.closeProof(true);
  expect((await gpu).status).toBe('ready');
  const before = h.manager.snapshot();
  cpu?.stale({ type: 'ready', version: 1, epoch: 1 });
  expect(h.manager.snapshot()).toEqual(before);
  expect(before).toMatchObject({ actualBackend: 'gpu', phase: 'ready', gpuCheck: { phase: 'ready' } });
  h.manager.release(2);
  h.manager.select('cpu');
  expect(h.manager.snapshot()).toMatchObject({ phase: 'retiring', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  const next = h.manager.acquire(3, signal);
  expect(h.clients).toHaveLength(2);
  h.clients[1]?.worker.exit();
  expect((await next).status).toBe('ready');
  h.manager.release(3);
  const disposal = h.manager.dispose();
  expect(h.manager.snapshot().phase).toBe('retiring');
  expect((await h.manager.acquire(4, signal)).status).toBe('canceled');
  h.clients[2]?.worker.exit();
  await disposal;
  expect(h.manager.snapshot().phase).toBe('disposed');
  h.verify();
});

it('ProofTrace: failed proof clears on reselection; canceled proof keeps its slot until close', async () => {
  const h = harness('gpu');
  const signal = new AbortController().signal;
  const failed = h.manager.acquire(1, signal);
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(1);
    },
    { interval: 5 },
  );
  h.closeProof(false);
  expect(await failed).toMatchObject({ status: 'unavailable' });
  expect(h.manager.snapshot()).toMatchObject({ phase: 'failed', gpuCheck: { phase: 'unavailable' } });
  h.manager.select('cpu');
  expect(h.manager.snapshot()).toMatchObject({ phase: 'cold', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  h.manager.select('gpu');
  const canceled = h.manager.acquire(2, signal);
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(2);
    },
    { interval: 5 },
  );
  h.manager.select('cpu');
  expect(h.proofSignal()?.aborted).toBe(true);
  expect(h.manager.snapshot()).toMatchObject({ phase: 'retiring', gpuCheck: { phase: 'idle' } });
  const latest = h.manager.acquire(3, signal);
  expect(h.clients).toHaveLength(0);
  h.closeProof(true);
  expect((await canceled).status).toBe('canceled');
  expect((await latest).status).toBe('ready');
  expect(h.observations.some(({ snapshot }) => snapshot.phase === 'cold' && snapshot.gpuCheck.phase === 'idle')).toBe(true);
  h.manager.release(3);
  const disposal = h.manager.dispose();
  h.clients[0]?.worker.exit();
  await disposal;
  h.verify();
});

it('GpuHealthTrace: failed GPU then fresh GPU proof survives a busy settings check', async () => {
  const h = harness('gpu');
  const signal = new AbortController().signal;
  const failed = h.manager.acquire(1, signal);
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(1);
    },
    { interval: 5 },
  );
  h.closeProof(false);
  expect((await failed).status).toBe('unavailable');
  const failedGeneration = h.manager.snapshot().generation;
  h.manager.select('cpu');
  h.manager.select('gpu');
  expect(h.manager.snapshot()).toMatchObject({
    phase: 'cold',
    actualBackend: 'none',
    gpuCheck: { phase: 'idle' },
    generation: failedGeneration + 2,
  });
  expect(h.manager.snapshot().failureReason).toBeUndefined();
  const next = h.manager.acquire(2, signal);
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(2);
    },
    { interval: 5 },
  );
  h.closeProof(true);
  expect((await next).status).toBe('ready');
  const before = h.manager.snapshot();
  const check = vi.fn().mockResolvedValue({ phase: 'ready' });
  expect(await h.manager.check(check, signal)).toEqual({ phase: 'unavailable', reason: 'busy' });
  expect(check).not.toHaveBeenCalled();
  expect(h.manager.snapshot()).toEqual(before);
  h.manager.release(2);
  const disposal = h.manager.dispose();
  expect(h.manager.snapshot().phase).toBe('retiring');
  h.clients[0]?.worker.exit();
  await disposal;
  h.verify();
});

it('CrashRestartTrace: unexpected exit clears the worker before retry and disposed admission stays closed', async () => {
  const h = harness('cpu');
  const signal = new AbortController().signal;
  expect((await h.manager.acquire(1, signal)).status).toBe('ready');
  h.clients[0]?.worker.exit();
  expect(h.manager.snapshot()).toMatchObject({ phase: 'cold', actualBackend: 'none', failureReason: 'worker_exit' });
  expect((await h.manager.acquire(2, signal)).status).toBe('ready');
  expect(h.manager.snapshot().failureReason).toBeUndefined();
  expect(h.clients).toHaveLength(2);
  h.manager.release(2);
  const disposal = h.manager.dispose();
  expect(h.manager.snapshot().phase).toBe('retiring');
  h.clients[1]?.worker.exit();
  await disposal;
  expect((await h.manager.acquire(3, signal)).status).toBe('canceled');
  h.verify();
  const restart = harness('cpu');
  expect((await restart.manager.acquire(1, signal)).status).toBe('ready');
  restart.manager.release(1);
  const closing = restart.manager.dispose();
  restart.clients[0]?.worker.exit();
  await closing;
  restart.verify();
});

it('DisposedProofTrace: disposal keeps proof ownership and publishes disposed only after close', async () => {
  const h = harness('gpu');
  const pending = h.manager.acquire(1, new AbortController().signal);
  await vi.waitFor(
    () => {
      expect(h.proofCount()).toBe(1);
    },
    { interval: 5 },
  );
  const disposal = h.manager.dispose();
  expect(h.proofSignal()?.aborted).toBe(true);
  expect(h.manager.snapshot().phase).toBe('retiring');
  expect(h.observations.some(({ snapshot }) => snapshot.phase === 'disposed')).toBe(false);
  h.closeProof(true);
  expect((await pending).status).toBe('canceled');
  await disposal;
  expect(h.manager.snapshot()).toMatchObject({ phase: 'disposed', actualBackend: 'none' });
  h.verify();
});
