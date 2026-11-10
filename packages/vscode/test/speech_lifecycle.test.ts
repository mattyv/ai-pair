import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
vi.mock('../src/speech_gpu_slot', () => ({ GpuProcessBusyError: class extends Error {} }));
const classifier = vi.hoisted(() =>
  vi.fn<(error: unknown) => import('../src/speech_types').LocalSpeechFailureReason>().mockReturnValue('worker_error'),
);
vi.mock('../src/speech_local_protocol', () => ({ localWorkerError: classifier }));
import { SpeechLifecycle, type SpeechLifecycleOptions } from '../src/speech_lifecycle';
import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import type { LocalListener, LocalSynthesisPort } from '../src/speech_local_client';

function fixture() {
  const proof = Promise.withResolvers<import('../src/speech_gpu_capability').GpuCapabilityResult>();
  let listener: LocalListener | undefined;
  let state: ReturnType<LocalSynthesisPort['state']> = 'cold';
  const worker: LocalSynthesisPort = {
    state: () => state,
    busy: () => false,
    load: vi.fn<LocalSynthesisPort['load']>(() => {
      state = 'loading';
    }),
    synthesize: vi.fn<LocalSynthesisPort['synthesize']>(() => Promise.resolve({ status: 'failed', reason: 'unavailable' })),
    cancel: vi.fn<() => void>(),
    retire: vi.fn<LocalSynthesisPort['retire']>((reason) => {
      state = 'retiring';
      listener?.retired(reason);
    }),
  };
  const prove = vi.fn((signal: AbortSignal) => {
    void signal;
    return proof.promise;
  });
  const changed = vi.fn<SpeechLifecycleOptions['changed']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'gpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: prove,
    createCpu: (owner) => {
      listener = owner;
      return worker;
    },
    createGpu: (capability, owner) => {
      void capability;
      listener = owner;
      return worker;
    },
    changed,
  });
  return {
    manager,
    changed,
    proof,
    prove,
    worker,
    ready: () => {
      state = 'ready';
      listener?.ready();
    },
    reap: () => {
      state = 'cold';
      listener?.reaped?.();
    },
  };
}

it('LatestProgress: cancels a stale proof and waits for its reaping before starting CPU', async () => {
  const { manager, proof, prove, worker, ready } = fixture();
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  manager.select('cpu');
  const second = manager.acquire(2, new AbortController().signal);
  expect(prove.mock.calls[0]?.[0].aborted).toBe(true);
  expect(worker.load).not.toHaveBeenCalled();
  proof.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  expect(await first).toEqual({ status: 'canceled' });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledWith('/model');
  });
  ready();
  expect((await second).status).toBe('ready');
});

it('Safety: waits for the old worker to exit before switching backends', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  expect((await first).status).toBe('ready');
  manager.select('gpu');
  expect(worker.retire).toHaveBeenCalled();
  expect(manager.snapshot().phase).toBe('retiring');
  reap();
  expect(manager.snapshot().actualBackend).toBe('none');
});

it('serializes an explicit setup check with speech acquisition and aborts it on mode change', async () => {
  const { manager, worker, ready } = fixture();
  const checkResult = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const check = vi.fn((signal: AbortSignal) => {
    void signal;
    return checkResult.promise;
  });
  const checking = manager.check(check, new AbortController().signal);
  await vi.waitFor(() => {
    expect(check).toHaveBeenCalledOnce();
  });
  manager.select('cpu');
  const speech = manager.acquire(2, new AbortController().signal);
  expect(check.mock.calls[0]?.[0].aborted).toBe(true);
  expect(worker.load).not.toHaveBeenCalled();
  checkResult.resolve({ phase: 'unavailable', reason: 'inconclusive' });
  await checking;
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledWith('/model');
  });
  ready();
  expect((await speech).status).toBe('ready');
});

it('does not retire a worker serving speech for a setup check', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  const request = manager.acquire(7, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await request;
  const operation = vi.fn(() => Promise.resolve({ phase: 'ready' } as const));
  expect(await manager.check(operation, new AbortController().signal)).toEqual({ phase: 'unavailable', reason: 'busy' });
  expect(worker.retire).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
  expect(manager.snapshot().gpuCheck).toEqual({ phase: 'idle' });
});

it('rejects a stale lease after a mode change', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(7, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  const result = await pending;
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('expected a lease');
  manager.select('gpu');
  const outcome = await manager.synthesize(result.lease, { id: 7, part: 0, final: true, text: 'hello', voice: 'af_heart', speed: 1 });
  expect(outcome).toEqual({ status: 'failed', reason: 'canceled' });
  expect(worker.synthesize).not.toHaveBeenCalled();
});

it('does not give a second unit the worker while the first owns it', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(7, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  expect((await pending).status).toBe('ready');
  expect(await manager.acquire(8, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'busy' });
});

it('rejects an inference whose unit does not own the lease', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(7, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  const result = await pending;
  if (result.status !== 'ready') throw new Error('expected a lease');
  expect(await manager.synthesize(result.lease, { id: 8, part: 0, final: true, text: 'hello', voice: 'af_heart', speed: 1 })).toEqual({
    status: 'failed',
    reason: 'canceled',
  });
  expect(worker.synthesize).not.toHaveBeenCalled();
});

it('aborts CPU model resolution on a mode change and waits for it to settle', async () => {
  const pending = Promise.withResolvers<string | undefined>();
  const resolveCpu = vi.fn((signal: AbortSignal) => {
    void signal;
    return pending.promise;
  });
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu,
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(resolveCpu).toHaveBeenCalledOnce();
  });
  expect(manager.snapshot().phase).toBe('loading');
  manager.select('gpu');
  expect(resolveCpu.mock.calls[0]?.[0].aborted).toBe(true);
  pending.resolve(undefined);
  expect(await first).toEqual({ status: 'canceled' });
});

it('does not wait forever for a worker whose spawn throws before ownership starts', async () => {
  const worker: LocalSynthesisPort = {
    state: () => 'cold',
    busy: () => false,
    load: () => {
      throw new Error('spawn failed');
    },
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<() => void>(),
    retire: vi.fn<() => void>(),
  };
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => worker,
    createGpu: () => worker,
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'worker_error' });
  await expect(manager.dispose()).resolves.toBeUndefined();
});

it('does not expose mutable internal GPU check state through snapshots', () => {
  const { manager } = fixture();
  const snapshot = manager.snapshot();
  Object.assign(snapshot.gpuCheck, { phase: 'ready' });
  expect(manager.snapshot().gpuCheck).toEqual({ phase: 'idle' });
});

it('does not spawn a stale worker if an observer changes mode during loading notification', async () => {
  const worker: LocalSynthesisPort = {
    state: () => 'cold',
    busy: () => false,
    load: vi.fn<() => void>(),
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<() => void>(),
    retire: vi.fn<() => void>(),
  };
  let loadingNotifications = 0;
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => worker,
    createGpu: () => worker,
    changed: (state) => {
      if (state.phase === 'loading' && ++loadingNotifications === 2) manager.select('gpu');
    },
  });
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(manager.snapshot().requestedMode).toBe('gpu');
  });
  expect(worker.load).not.toHaveBeenCalled();
  expect(await pending).toEqual({ status: 'canceled' });
  expect(manager.snapshot().phase).toBe('cold');
});

it('waits for canceled inference to release its worker before the next unit starts', async () => {
  let listener: LocalListener | undefined;
  let state: ReturnType<LocalSynthesisPort['state']> = 'cold';
  let busy = false;
  const inference = Promise.withResolvers<import('../src/speech_local_client').LocalSynthesisOutcome>();
  const worker: LocalSynthesisPort = {
    state: () => state,
    busy: () => busy,
    load: vi.fn<LocalSynthesisPort['load']>(() => {
      state = 'loading';
    }),
    synthesize: vi.fn(() => {
      busy = true;
      return inference.promise;
    }),
    cancel: vi.fn<() => void>(),
    retire: vi.fn(() => {
      state = 'retiring';
      listener?.retired('worker_exit');
    }),
  };
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: (owner) => {
      listener = owner;
      return worker;
    },
    createGpu: () => worker,
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  state = 'ready';
  listener?.ready();
  const acquired = await first;
  if (acquired.status !== 'ready') throw new Error('expected a lease');
  void manager.synthesize(acquired.lease, { id: 1, part: 0, final: true, text: 'hello', voice: 'af_heart', speed: 1 });
  manager.release(1);
  const next = manager.acquire(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalled();
  });
  state = 'cold';
  busy = false;
  listener?.reaped?.();
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  state = 'ready';
  listener?.ready();
  expect((await next).status).toBe('ready');
  inference.resolve({ status: 'failed', reason: 'canceled' });
});

it('releases a unit when its worker exits unexpectedly', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  expect((await first).status).toBe('ready');
  worker.retire('worker_exit');
  reap();
  const check = vi.fn(() => Promise.resolve({ phase: 'ready' } as const));
  expect(await manager.check(check, new AbortController().signal)).toEqual({ phase: 'ready' });
  expect(check).toHaveBeenCalledOnce();
});

it('DisposeProgress: aborts a pending proof on shutdown and waits for the proof to be reaped', async () => {
  const { manager, prove, proof } = fixture();
  const acquisition = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  let finished = false;
  const disposing = manager.dispose().then(() => {
    finished = true;
  });
  expect(prove.mock.calls[0]?.[0].aborted).toBe(true);
  await Promise.resolve();
  expect(finished).toBe(false);
  proof.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  expect(await acquisition).toEqual({ status: 'canceled' });
  await disposing;
  expect(manager.snapshot().phase).toBe('disposed');
});

it('Safety: never starts CPU after an explicit GPU proof failure', async () => {
  const { manager, proof, prove, worker } = fixture();
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  expect((await pending).status).toBe('unavailable');
  expect(worker.load).not.toHaveBeenCalled();
});

it('does not publish a successful setup result after its generation is canceled', async () => {
  const { manager } = fixture();
  const result = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const operation = vi.fn((signal: AbortSignal) => {
    void signal;
    return result.promise;
  });
  const pending = manager.check(operation, new AbortController().signal);
  await vi.waitFor(() => {
    expect(operation).toHaveBeenCalledOnce();
  });
  manager.select('cpu');
  result.resolve({ phase: 'ready' });
  expect(await pending).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  expect(manager.snapshot().gpuCheck.phase).not.toBe('ready');
});

it('owns setup progress and ignores reports after cancellation', async () => {
  const { manager } = fixture();
  const pendingResult = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  let progress: ((value: import('../src/speech_compute_types').GpuCheckProgress) => void) | undefined;
  const pending = manager.check((signal, report) => {
    void signal;
    progress = report;
    return pendingResult.promise;
  }, new AbortController().signal);
  await vi.waitFor(() => {
    expect(progress).toBeDefined();
  });
  progress?.({ stage: 'verify' });
  expect(manager.snapshot().gpuCheck).toEqual({ phase: 'checking', progress: { stage: 'verify' } });
  manager.select('cpu');
  pendingResult.resolve({ phase: 'ready' });
  await pending;
  progress?.({ stage: 'download', current: 1, total: 2 });
  expect(manager.snapshot().gpuCheck).not.toEqual({ phase: 'checking', progress: { stage: 'download', current: 1, total: 2 } });
});

it('does not fall back while another GPU process owns the shared slot', async () => {
  const cpu = vi.fn<SpeechLifecycleOptions['resolveCpu']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'auto',
    resolveCpu: cpu,
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'busy' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'busy' });
  expect(cpu).not.toHaveBeenCalled();
});

it('does not start a proof after a checking observer changes mode', async () => {
  const prove = vi.fn<SpeechLifecycleOptions['proveGpu']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'gpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: prove,
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: (snapshot) => {
      if (snapshot.phase === 'checking') manager.select('cpu');
    },
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'canceled' });
  expect(prove).not.toHaveBeenCalled();
});

it('reuses an idle ready worker and forwards only the current unit inference', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  const acquired = await first;
  if (acquired.status !== 'ready') throw new Error('expected a lease');
  expect(manager.busy()).toBe(false);
  const request = { id: 1, part: 0, final: true, text: 'hello', voice: 'af_heart' as const, speed: 1 };
  await manager.synthesize(acquired.lease, request);
  expect(worker.synthesize).toHaveBeenCalledWith(request);
  manager.release(1);
  manager.release(1);
  const next = await manager.acquire(2, new AbortController().signal);
  expect(next.status).toBe('ready');
  expect(worker.load).toHaveBeenCalledOnce();
  manager.release(2);
  manager.retireWorker('timeout');
  expect(worker.retire).toHaveBeenCalledWith('timeout');
  expect(manager.snapshot().failureReason).toBe('timeout');
  reap();
  await manager.dispose();
  expect(manager.busy()).toBe(false);
  manager.retireWorker('timeout');
});

it('turns setup exceptions into fixed unavailable results', async () => {
  const { manager } = fixture();
  const result = await manager.check(() => Promise.reject(new Error('private')), new AbortController().signal);
  expect(result).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  expect(manager.snapshot().gpuCheck).toEqual(result);
});

it('stops a pending setup check when its caller aborts', async () => {
  const { manager } = fixture();
  const done = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const operation = vi.fn((signal: AbortSignal) => {
    void signal;
    return done.promise;
  });
  const controller = new AbortController();
  const pending = manager.check(operation, controller.signal);
  await vi.waitFor(() => {
    expect(operation).toHaveBeenCalledOnce();
  });
  controller.abort();
  expect(operation.mock.calls[0]?.[0].aborted).toBe(true);
  done.resolve({ phase: 'ready' });
  expect(await pending).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
});

it('starts the verified GPU worker only after proof and reports its observed backend', async () => {
  const { manager, proof, prove, worker, ready } = fixture();
  const capability = mock<import('../src/speech_gpu_client').GpuLaunchCapability>({ modelDirectory: '/gpu' });
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'ready' }, capability });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledWith('/gpu');
  });
  expect(manager.snapshot().actualBackend).toBe('none');
  ready();
  expect((await pending).status).toBe('ready');
  expect(manager.snapshot().actualBackend).toBe('gpu');
});

it('falls back in Auto after an unavailable proof but not after an explicit GPU failure', async () => {
  const { manager, proof, prove, worker, ready } = fixture();
  manager.select('auto');
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledWith('/model');
  });
  ready();
  expect((await pending).status).toBe('ready');
  expect(manager.snapshot().actualBackend).toBe('cpu');
});

it('reports model discovery failures without launching a worker', async () => {
  const create = vi.fn<SpeechLifecycleOptions['createCpu']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.reject(new Error('private')),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: create,
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'model_missing' });
  expect(create).not.toHaveBeenCalled();
});

it('reports a worker retirement reason while startup is pending', async () => {
  const { manager, worker, reap } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  manager.retireWorker('timeout');
  expect(await pending).toEqual({ status: 'unavailable', reason: 'timeout' });
  reap();
});

it('publishes cold and clears checking after a canceled proof has actually settled', async () => {
  const { manager, proof, prove } = fixture();
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  manager.select('cpu');
  expect(manager.snapshot().phase).toBe('retiring');
  proof.resolve({ check: { phase: 'ready' } });
  expect(await pending).toEqual({ status: 'canceled' });
  expect(manager.snapshot()).toMatchObject({ requestedMode: 'cpu', phase: 'cold', gpuCheck: { phase: 'idle' } });
});

it('maps proof exceptions to a fixed failure before Auto fallback', async () => {
  const cpu = vi.fn<SpeechLifecycleOptions['resolveCpu']>().mockResolvedValue(undefined);
  const manager = new SpeechLifecycle({
    requestedMode: 'auto',
    resolveCpu: cpu,
    proveGpu: () => Promise.reject(new Error('private')),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'model_missing' });
  expect(manager.snapshot().gpuCheck).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});

it('retires a worker if load throws after it acquired a resource', async () => {
  let state: ReturnType<LocalSynthesisPort['state']> = 'cold';
  let listener: LocalListener | undefined;
  const worker: LocalSynthesisPort = {
    state: () => state,
    busy: () => false,
    load: () => {
      state = 'loading';
      throw new Error('private');
    },
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<() => void>(),
    retire: vi.fn<LocalSynthesisPort['retire']>((reason) => {
      state = 'retiring';
      listener?.retired(reason);
    }),
  };
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: (owner) => {
      listener = owner;
      return worker;
    },
    createGpu: () => worker,
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'worker_error' });
  expect(worker.retire).toHaveBeenCalled();
  const closing = manager.dispose();
  state = 'cold';
  listener?.reaped?.();
  await closing;
});

it('aborts an acquisition proof when its caller cancels', async () => {
  const { manager, prove, proof } = fixture();
  const controller = new AbortController();
  const pending = manager.acquire(1, controller.signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  controller.abort();
  expect(prove.mock.calls[0]?.[0].aborted).toBe(true);
  proof.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  expect(await pending).toEqual({ status: 'canceled' });
});

it('aborts CPU discovery when its caller cancels', async () => {
  const done = Promise.withResolvers<string | undefined>();
  const resolveCpu = vi.fn((signal: AbortSignal) => {
    void signal;
    return done.promise;
  });
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu,
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  const controller = new AbortController();
  const pending = manager.acquire(1, controller.signal);
  await vi.waitFor(() => {
    expect(resolveCpu).toHaveBeenCalledOnce();
  });
  controller.abort();
  expect(resolveCpu.mock.calls[0]?.[0].aborted).toBe(true);
  done.resolve('/model');
  expect(await pending).toEqual({ status: 'canceled' });
});

it('retires a loading worker when its caller cancels', async () => {
  const { manager, worker, reap } = fixture();
  manager.select('cpu');
  const controller = new AbortController();
  const pending = manager.acquire(1, controller.signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  controller.abort();
  expect(worker.retire).toHaveBeenCalled();
  expect(await pending).toEqual({ status: 'canceled' });
  reap();
});

it('ignores callbacks from an old worker after a new worker starts', async () => {
  const owners: LocalListener[] = [];
  let state: ReturnType<LocalSynthesisPort['state']> = 'cold';
  const worker: LocalSynthesisPort = {
    state: () => state,
    busy: () => false,
    load: vi.fn<LocalSynthesisPort['load']>(() => {
      state = 'loading';
    }),
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<() => void>(),
    retire: vi.fn<LocalSynthesisPort['retire']>((reason) => {
      state = 'retiring';
      owners.at(-1)?.retired(reason);
    }),
  };
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: (owner) => {
      owners.push(owner);
      return worker;
    },
    createGpu: () => worker,
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  const first = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(owners.length).toBe(1);
  });
  state = 'ready';
  owners[0]?.ready();
  expect((await first).status).toBe('ready');
  manager.release(1);
  manager.retireWorker('worker_exit');
  state = 'cold';
  owners[0]?.reaped?.();
  const second = manager.acquire(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(owners.length).toBe(2);
  });
  owners[0]?.ready();
  owners[0]?.retired('worker_error');
  owners[0]?.reaped?.();
  expect(manager.snapshot().phase).toBe('loading');
  state = 'ready';
  owners[1]?.ready();
  expect((await second).status).toBe('ready');
});

it('rejects checks and acquisitions already canceled before starting', async () => {
  const { manager, prove } = fixture();
  const controller = new AbortController();
  controller.abort();
  expect(await manager.check(() => Promise.resolve({ phase: 'ready' }), controller.signal)).toEqual({
    phase: 'unavailable',
    reason: 'inconclusive',
  });
  expect(await manager.acquire(1, controller.signal)).toEqual({ status: 'canceled' });
  expect(prove).not.toHaveBeenCalled();
});

it('keeps the queue usable after a worker state query unexpectedly throws', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  const initial = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await initial;
  manager.release(1);
  const originalState = worker.state;
  worker.state = vi
    .fn<LocalSynthesisPort['state']>()
    .mockImplementationOnce(() => {
      throw new Error('private');
    })
    .mockImplementation(originalState);
  expect(await manager.acquire(2, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'worker_error' });
  expect((await manager.acquire(3, new AbortController().signal)).status).toBe('ready');
});

it('keeps the queue usable after a retirement unexpectedly throws during a check', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const initial = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await initial;
  manager.release(1);
  vi.mocked(worker.retire).mockImplementationOnce(() => {
    throw new Error('private');
  });
  expect(await manager.check(() => Promise.resolve({ phase: 'ready' }), new AbortController().signal)).toEqual({
    phase: 'unavailable',
    reason: 'probe_failed',
  });
  const next = manager.acquire(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalledTimes(2);
  });
  reap();
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  ready();
  expect((await next).status).toBe('ready');
});

it('reports a thrown GPU slot conflict without falling back', async () => {
  const resolveCpu = vi.fn<SpeechLifecycleOptions['resolveCpu']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'auto',
    resolveCpu,
    proveGpu: () => Promise.reject(new GpuProcessBusyError()),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'busy' });
  expect(resolveCpu).not.toHaveBeenCalled();
});

it('does not start an explicit setup operation after its checking observer changes mode', async () => {
  const operation = vi.fn<(signal: AbortSignal) => Promise<import('../src/speech_compute_types').GpuCheck>>();
  const manager = new SpeechLifecycle({
    requestedMode: 'gpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: (state) => {
      if (state.phase === 'checking') manager.select('cpu');
    },
  });
  expect(await manager.check(operation, new AbortController().signal)).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  expect(operation).not.toHaveBeenCalled();
});

it('discards a setup check canceled while it waits for an old worker to exit', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const initial = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await initial;
  manager.release(1);
  const operation = vi.fn<(signal: AbortSignal) => Promise<import('../src/speech_compute_types').GpuCheck>>();
  const check = manager.check(operation, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalled();
  });
  manager.select('gpu');
  reap();
  expect(await check).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  expect(operation).not.toHaveBeenCalled();
});

it('discards an acquisition canceled while it waits for an old worker to exit', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const initial = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await initial;
  manager.release(1);
  worker.busy = () => true;
  const next = manager.acquire(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalled();
  });
  manager.select('gpu');
  reap();
  expect(await next).toEqual({ status: 'canceled' });
  expect(worker.load).toHaveBeenCalledOnce();
});

it('waits for a setup check to settle during disposal and finishes disposed', async () => {
  const { manager } = fixture();
  const done = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const operation = vi.fn<(signal: AbortSignal) => Promise<import('../src/speech_compute_types').GpuCheck>>(() => done.promise);
  const check = manager.check(operation, new AbortController().signal);
  await vi.waitFor(() => {
    expect(operation).toHaveBeenCalledOnce();
  });
  const closing = manager.dispose();
  expect(operation.mock.calls[0]?.[0].aborted).toBe(true);
  done.resolve({ phase: 'ready' });
  await check;
  await closing;
  expect(manager.snapshot().phase).toBe('disposed');
});

it('waits for CPU discovery to settle during disposal and finishes disposed', async () => {
  const done = Promise.withResolvers<string | undefined>();
  const resolveCpu = vi.fn<SpeechLifecycleOptions['resolveCpu']>(() => done.promise);
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu,
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(resolveCpu).toHaveBeenCalledOnce();
  });
  const closing = manager.dispose();
  expect(resolveCpu.mock.calls[0]?.[0].aborted).toBe(true);
  done.resolve('/model');
  expect(await pending).toEqual({ status: 'canceled' });
  await closing;
  expect(manager.snapshot().phase).toBe('disposed');
});

it('does not start CPU discovery if an observer changes mode during its loading notification', async () => {
  const resolveCpu = vi.fn<SpeechLifecycleOptions['resolveCpu']>();
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu,
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('unexpected');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: (state) => {
      if (state.phase === 'loading') manager.select('gpu');
    },
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'canceled' });
  expect(resolveCpu).not.toHaveBeenCalled();
});

it('remains disposed when shutdown occurs just before worker spawn', async () => {
  const worker: LocalSynthesisPort = {
    state: () => 'cold',
    busy: () => false,
    load: vi.fn<LocalSynthesisPort['load']>(),
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<LocalSynthesisPort['cancel']>(),
    retire: vi.fn<LocalSynthesisPort['retire']>(),
  };
  let loadingNotifications = 0;
  let closing: Promise<void> | undefined;
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => worker,
    createGpu: () => worker,
    changed: (state) => {
      if (state.phase === 'loading' && ++loadingNotifications === 2) closing = manager.dispose();
    },
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'canceled' });
  await closing;
  expect(worker.load).not.toHaveBeenCalled();
  expect(manager.snapshot().phase).toBe('disposed');
});

it('returns a fixed error when the worker factory fails before allocating a lease', async () => {
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => {
      throw new Error('private');
    },
    createGpu: () => {
      throw new Error('unexpected');
    },
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'worker_error' });
  await manager.dispose();
});

it('distinguishes planned backend retirement from an unexpected worker failure', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await pending;
  manager.select('gpu');
  reap();
  expect(manager.snapshot().failureReason).toBeUndefined();
});

it('clears stale GPU failure when switching GPU to CPU and back', async () => {
  const { manager, proof, prove } = fixture();
  const request = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  expect((await request).status).toBe('unavailable');
  expect(manager.snapshot().phase).toBe('failed');
  manager.select('cpu');
  expect(manager.snapshot()).toMatchObject({ requestedMode: 'cpu', phase: 'cold', gpuCheck: { phase: 'idle' } });
  manager.select('gpu');
  expect(manager.snapshot()).toMatchObject({ requestedMode: 'gpu', phase: 'cold', gpuCheck: { phase: 'idle' } });
});

it('keeps verified GPU health when a setup check is refused during speech', async () => {
  const { manager, proof, prove, worker, ready } = fixture();
  const capability = mock<import('../src/speech_gpu_client').GpuLaunchCapability>({ modelDirectory: '/gpu' });
  const request = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'ready' }, capability });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledWith('/gpu');
  });
  ready();
  expect((await request).status).toBe('ready');
  expect(await manager.check(() => Promise.resolve({ phase: 'ready' }), new AbortController().signal)).toEqual({
    phase: 'unavailable',
    reason: 'busy',
  });
  expect(manager.snapshot()).toMatchObject({ phase: 'ready', actualBackend: 'gpu', gpuCheck: { phase: 'ready' } });
});

it('leaves health and generation unchanged when the selected mode is unchanged', () => {
  const { manager } = fixture();
  const before = manager.snapshot();
  manager.select('gpu');
  expect(manager.snapshot()).toEqual(before);
});

it('never publishes disposed while an aborted proof is still owned', async () => {
  const { manager, changed, proof, prove } = fixture();
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  changed.mockClear();
  const closing = manager.dispose();
  expect(changed.mock.calls.map(([snapshot]) => snapshot.phase)).not.toContain('disposed');
  proof.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  await pending;
  await closing;
  expect(manager.snapshot().phase).toBe('disposed');
});

it('never publishes disposed while a worker is waiting to exit', async () => {
  const { manager, changed, worker, ready, reap } = fixture();
  manager.select('cpu');
  const pending = manager.acquire(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalled();
  });
  ready();
  await pending;
  changed.mockClear();
  const closing = manager.dispose();
  expect(changed.mock.calls.map(([snapshot]) => snapshot.phase)).not.toContain('disposed');
  reap();
  await closing;
  expect(manager.snapshot().phase).toBe('disposed');
});

it('TypeOK: starts with a valid cold CPU snapshot', () => {
  const { manager } = fixture();
  manager.select('cpu');
  expect(manager.snapshot()).toMatchObject({
    requestedMode: 'cpu',
    actualBackend: 'none',
    phase: 'cold',
    gpuCheck: { phase: 'idle' },
    generation: 1,
  });
});

it('preserves the sanitized module category when worker startup throws', async () => {
  const failure = Object.assign(new Error('private worker path'), { code: 'MODULE_NOT_FOUND' });
  classifier.mockReturnValueOnce('worker_module');
  const worker: LocalSynthesisPort = {
    state: () => 'cold',
    busy: () => false,
    load: () => {
      throw failure;
    },
    synthesize: () => Promise.resolve({ status: 'failed', reason: 'unavailable' }),
    cancel: vi.fn<LocalSynthesisPort['cancel']>(),
    retire: vi.fn<LocalSynthesisPort['retire']>(),
  };
  const manager = new SpeechLifecycle({
    requestedMode: 'cpu',
    resolveCpu: () => Promise.resolve('/model'),
    proveGpu: () => Promise.resolve({ check: { phase: 'unavailable', reason: 'inconclusive' } }),
    createCpu: () => worker,
    createGpu: () => worker,
    changed: vi.fn<SpeechLifecycleOptions['changed']>(),
  });
  expect(await manager.acquire(1, new AbortController().signal)).toEqual({ status: 'unavailable', reason: 'worker_module' });
  expect(classifier).toHaveBeenCalledWith(failure);
  await manager.dispose();
});

it('WarmupSafe: prepares one worker and lends it to the first narration', async () => {
  const { manager, worker, ready } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  manager.prepare(true);
  const narration = manager.acquire(42, new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(1);
  });
  ready();
  expect((await narration).status).toBe('ready');
  expect(worker.load).toHaveBeenCalledTimes(1);
  expect(worker.synthesize).not.toHaveBeenCalled();
});

it('WarmupSafe: disabling during loading retires the worker and blocks stale readiness', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledOnce();
  });
  manager.prepare(false);
  expect(worker.retire).toHaveBeenCalledOnce();
  ready();
  expect(manager.snapshot().phase).not.toBe('ready');
  reap();
  expect(manager.snapshot().phase).toBe('cold');
});

it('WarmupSafe: re-enabling waits for the retired worker before starting a replacement', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(1);
  });
  manager.prepare(false);
  manager.prepare(true);
  expect(worker.load).toHaveBeenCalledTimes(1);
  reap();
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  ready();
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('ready');
  });
});

it('restores warm demand after an explicit setup check retires the worker', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(1);
  });
  ready();
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('ready');
  });
  const checked = manager.check(() => Promise.resolve({ phase: 'ready' }), new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalled();
  });
  reap();
  expect(await checked).toEqual({ phase: 'ready' });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  ready();
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('ready');
  });
});

it('does not start disabled or disposed warm demand', async () => {
  const { manager, worker } = fixture();
  manager.prepare(true);
  manager.prepare(false);
  await Promise.resolve();
  expect(worker.load).not.toHaveBeenCalled();
  await manager.dispose();
  manager.prepare(true);
  expect(worker.load).not.toHaveBeenCalled();
});

it('retries a failed warmup when setup completes', async () => {
  const { manager, proof, prove } = fixture();
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  proof.resolve({ check: { phase: 'unavailable', reason: 'runtime_missing' } });
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('failed');
  });
  manager.prepare(true, true);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledTimes(2);
  });
});

it('restarts warm demand after changing compute mode', async () => {
  const { manager, proof, prove, worker, ready } = fixture();
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(prove).toHaveBeenCalledOnce();
  });
  manager.select('cpu');
  proof.resolve({ check: { phase: 'unavailable', reason: 'runtime_missing' } });
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledOnce();
  });
  ready();
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('ready');
  });
});

it('retries after an unexpected warm worker failure', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(1);
  });
  ready();
  await vi.waitFor(() => {
    expect(manager.snapshot().phase).toBe('ready');
  });
  worker.retire('timeout');
  reap();
  manager.prepare(true, true);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  ready();
});

it('keeps the lifecycle usable if a warm worker state check throws', async () => {
  const { manager, worker, ready, reap } = fixture();
  manager.select('cpu');
  manager.prepare(true);
  const first = manager.check(() => Promise.resolve({ phase: 'ready' }), new AbortController().signal);
  const second = manager.check(() => Promise.resolve({ phase: 'ready' }), new AbortController().signal);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(1);
  });
  ready();
  await vi.waitFor(() => {
    expect(worker.retire).toHaveBeenCalled();
  });
  reap();
  await Promise.all([first, second]);
  await vi.waitFor(() => {
    expect(worker.load).toHaveBeenCalledTimes(2);
  });
  ready();
  const state = vi.spyOn(worker, 'state').mockImplementationOnce(() => {
    throw new Error('state error');
  });
  await vi.waitFor(() => {
    expect(state).toHaveBeenCalled();
  });
  state.mockRestore();
  expect((await manager.acquire(8, new AbortController().signal)).status).toBe('ready');
});
