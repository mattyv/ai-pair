// The service and real synthesis clients share fake transports and a fake output; no hardware or provider is used.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { LocalSynthesisClient, type LocalListener, type WorkerLike } from '../src/speech_local_client';
import { LOCAL_REQUEST } from '../src/speech_local_protocol';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { GpuLaunchCapability } from '../src/speech_gpu_client';
import type { GpuCapabilityResult } from '../src/speech_gpu_capability';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { SpeechWorkerHost } from '../src/speech_worker_host';
import type { SpeechEngine, SpeechTokens } from '../src/speech_synthesis';
import { SpeechOutputRouter, type NativeDriver } from '../src/speech_output_router';
import type { OutputChoice } from '../src/speech_output_types';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

/** A deterministic engine exercises the real host and encoder without an audio device. */
async function engine(gates: Gates): Promise<SpeechEngine<SpeechTokens>> {
  await gates.load?.promise;
  return {
    phonemize: () => Promise.resolve('a'),
    tokenize: () => ({ dims: [1, 5] }),
    generate: async () => {
      gates.inferenceStarted?.resolve();
      await gates.inference?.promise;
      return { samples: new Float32Array(12_000).fill(0.2), rate: 24_000 };
    },
  };
}

interface Gates {
  load?: PromiseWithResolvers<void>;
  inference?: PromiseWithResolvers<void>;
  inferenceStarted?: PromiseWithResolvers<void>;
}

/** Runs the real host with cloned messages and explicitly controlled exit. */
class Worker implements WorkerLike {
  exited = false;
  readonly terminate = vi.fn(() => Promise.resolve(0));
  private readonly listeners = new Map<string, (value: unknown) => void>();
  private readonly host: SpeechWorkerHost<SpeechTokens>;
  constructor(gates: Gates) {
    this.host = new SpeechWorkerHost(
      () => engine(gates),
      (message) => {
        queueMicrotask(() => {
          this.listeners.get('message')?.(structuredClone(message));
        });
      },
    );
  }
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  postMessage(value: unknown): void {
    const request = structuredClone(LOCAL_REQUEST.parse(value));
    queueMicrotask(() => {
      void this.host.receive(request);
    });
  }
  /** Reports the operating-system exit after retirement. */
  exit(): void {
    this.exited = true;
    this.listeners.get('exit')?.(0);
  }
}

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const arch = Object.getOwnPropertyDescriptor(process, 'arch');
const services: SpeechService[] = [];

/** Composes both real clients with independent, manually reaped fake workers. */
function compose(initialMode: 'cpu' | 'gpu' | 'auto' = 'cpu', selectedOutput?: SpeechOutput) {
  let mode: 'cpu' | 'gpu' | 'auto' = initialMode;
  const workers: Record<'cpu' | 'gpu', Worker[]> = { cpu: [], gpu: [] };
  const gates: Gates = {};
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const capability = mock<GpuLaunchCapability>({ modelDirectory: '/gpu-model' });
  const authorize = vi.fn<(signal: AbortSignal) => Promise<GpuCapabilityResult>>().mockImplementation(() => {
    expect([...workers.cpu, ...workers.gpu].filter((worker) => !worker.exited)).toHaveLength(0);
    return Promise.resolve({ check: { phase: 'ready' }, capability });
  });
  function factory(kind: 'cpu' | 'gpu', listener: LocalListener): LocalSynthesisClient {
    return new LocalSynthesisClient({
      listener,
      spawn: () => {
        expect([...workers.cpu, ...workers.gpu].filter((worker) => !worker.exited)).toHaveLength(0);
        const worker = new Worker(gates);
        workers[kind].push(worker);
        return worker;
      },
    });
  }
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output: selectedOutput ?? output,
    createLocal: (listener) => factory('cpu', listener),
    createGpu: (verified, listener) => {
      expect(verified).toBe(capability);
      return factory('gpu', listener);
    },
    gpuCapability: authorize,
    computeMode: () => mode,
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  services.push(service);
  return {
    service,
    output,
    workers,
    gates,
    authorize,
    setMode: (value: 'cpu' | 'gpu' | 'auto') => {
      mode = value;
      service.selectComputeMode(value);
    },
  };
}

/** Waits for the mocked output and acknowledges its synthetic waveform. */
async function finish(
  service: SpeechService,
  output: ReturnType<typeof mock<SpeechOutput>>,
  pending: Promise<void>,
  id: number,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(output.play.mock.calls.at(-1)?.[0]).toBe(id);
    },
    { interval: 5 },
  );
  expect(output.play.mock.calls.at(-1)).toEqual([id, expect.any(Uint8Array), expect.any(Number)]);
  expect(service.audioEvent({ id, pageId: 7, event: 'ended' })).toBe('ended');
  await pending;
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  vi.mocked(installedSpeechModel).mockResolvedValue('/model');
  vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
});
afterEach(() => {
  for (const service of services.splice(0)) void service.dispose();
  vi.resetAllMocks();
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
});

it('RepeatedHandoff: twenty CPU to GPU to CPU cycles wait for each real host to exit', async () => {
  const { service, output, workers, authorize, setMode } = compose();
  let id = 1;
  await finish(service, output, service.speak('Initial CPU.'), id++);
  for (let cycle = 0; cycle < 20; cycle++) {
    const cpu = workers.cpu[cycle];
    setMode('gpu');
    const gpuRequest = service.speak('GPU.');
    await vi.waitFor(
      () => {
        expect(cpu?.terminate).toHaveBeenCalledOnce();
      },
      { interval: 5 },
    );
    expect(workers.gpu).toHaveLength(cycle);
    expect(authorize).toHaveBeenCalledTimes(cycle);
    cpu?.exit();
    await finish(service, output, gpuRequest, id++);
    const gpu = workers.gpu[cycle];
    setMode('cpu');
    const cpuRequest = service.speak('CPU.');
    await vi.waitFor(
      () => {
        expect(gpu?.terminate).toHaveBeenCalledOnce();
      },
      { interval: 5 },
    );
    expect(workers.cpu).toHaveLength(cycle + 1);
    gpu?.exit();
    await finish(service, output, cpuRequest, id++);
  }
  expect(output.play).toHaveBeenCalledTimes(41);
  expect(workers.cpu).toHaveLength(21);
  expect(workers.gpu).toHaveLength(20);
}, 120_000);

it('LatestModeAfterReap: rapid CPU to GPU to CPU keeps the latest first request waiting', async () => {
  const { service, output, workers, authorize, setMode } = compose();
  await finish(service, output, service.speak('Initial CPU.'), 1);
  setMode('gpu');
  const obsolete = service.speak('Obsolete GPU.');
  await vi.waitFor(() => {
    expect(workers.cpu[0]?.terminate).toHaveBeenCalledOnce();
  });
  service.cancel();
  await obsolete;
  setMode('cpu');
  const latest = service.speak('Latest CPU.');
  expect(workers.cpu).toHaveLength(1);
  expect(authorize).not.toHaveBeenCalled();
  workers.cpu[0]?.exit();
  await finish(service, output, latest, 3);
  expect(output.play).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
  expect(workers.gpu).toHaveLength(0);
});

for (const mode of ['cpu', 'gpu', 'auto'] as const) {
  it(`SavedModeFirstSpeech: a fresh host speaks using saved ${mode} without opening settings`, async () => {
    const { service, output, workers, authorize } = compose(mode);
    await finish(service, output, service.speak('First after restart.'), 1);
    expect(workers.cpu).toHaveLength(mode === 'cpu' ? 1 : 0);
    expect(workers.gpu).toHaveLength(mode === 'cpu' ? 0 : 1);
    expect(authorize).toHaveBeenCalledTimes(mode === 'cpu' ? 0 : 1);
  });
}

it('ExplicitGpuFailure: failed proof never silently falls back and a later CPU request recovers', async () => {
  const { service, output, workers, authorize, setMode } = compose('gpu');
  authorize.mockResolvedValueOnce({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await service.speak('Unavailable GPU.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  expect(output.play).not.toHaveBeenCalled();
  expect(workers.cpu).toHaveLength(0);
  expect(workers.gpu).toHaveLength(0);
  setMode('cpu');
  await finish(service, output, service.speak('CPU recovery.'), 2);
  expect(workers.cpu).toHaveLength(1);
});

it('ProofOwnership: switching to CPU waits for the canceled GPU proof to close', async () => {
  const { service, output, workers, authorize, setMode } = compose('gpu');
  const proof = Promise.withResolvers<GpuCapabilityResult>();
  let proofSignal: AbortSignal | undefined;
  authorize.mockImplementationOnce((signal) => {
    proofSignal = signal;
    return proof.promise;
  });
  const obsolete = service.speak('GPU proof pending.');
  await vi.waitFor(
    () => {
      expect(authorize).toHaveBeenCalledOnce();
    },
    { interval: 5 },
  );
  setMode('cpu');
  await obsolete;
  expect(proofSignal?.aborted).toBe(true);
  const latest = service.speak('CPU after proof.');
  try {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(workers.cpu).toHaveLength(0);
  } finally {
    proof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  }
  await finish(service, output, latest, 2);
  expect(output.play).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
});

it('RestartGpu: a disposed host reaps its worker and a fresh host speaks with saved GPU mode', async () => {
  const first = compose('gpu');
  await finish(first.service, first.output, first.service.speak('Before restart.'), 1);
  const disposed = first.service.dispose();
  await vi.waitFor(
    () => {
      expect(first.workers.gpu[0]?.terminate).toHaveBeenCalledOnce();
    },
    { interval: 5 },
  );
  first.workers.gpu[0]?.exit();
  await disposed;
  const restarted = compose('gpu');
  await finish(restarted.service, restarted.output, restarted.service.speak('After restart.'), 1);
  expect(restarted.authorize).toHaveBeenCalledOnce();
  expect(restarted.workers.gpu).toHaveLength(1);
  expect(restarted.workers.cpu).toHaveLength(0);
});

for (const phase of ['loading', 'synthesis', 'playback'] as const) {
  it(`PhaseFlip: switching during ${phase} discards stale work and plays the latest request after exit`, async () => {
    const { service, output, workers, gates, setMode } = compose();
    if (phase === 'loading') gates.load = Promise.withResolvers<void>();
    if (phase === 'synthesis') {
      gates.inference = Promise.withResolvers<void>();
      gates.inferenceStarted = Promise.withResolvers<void>();
    }
    const obsolete = service.speak('Old CPU request.');
    await vi.waitFor(
      () => {
        expect(workers.cpu).toHaveLength(1);
      },
      { interval: 5 },
    );
    if (phase === 'synthesis') await gates.inferenceStarted?.promise;
    if (phase === 'playback') {
      await vi.waitFor(
        () => {
          expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), expect.any(Number));
        },
        { interval: 5 },
      );
    }
    setMode('gpu');
    await obsolete;
    await vi.waitFor(
      () => {
        expect(workers.cpu[0]?.terminate).toHaveBeenCalledOnce();
      },
      { interval: 5 },
    );
    const latest = service.speak('New GPU request.');
    expect(workers.gpu).toHaveLength(0);
    const oldLoad = gates.load;
    const oldInference = gates.inference;
    gates.load = undefined;
    gates.inference = undefined;
    workers.cpu[0]?.exit();
    oldLoad?.resolve();
    oldInference?.resolve();
    await vi.waitFor(
      () => {
        expect(output.play).toHaveBeenCalledWith(2, expect.any(Uint8Array), expect.any(Number));
      },
      { interval: 5 },
    );
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
    await finish(service, output, latest, 2);
    expect(output.play.mock.calls.filter(([id]) => id === 1)).toHaveLength(phase === 'playback' ? 1 : 0);
    expect(workers.gpu).toHaveLength(1);
  });
}

for (const mode of ['cpu', 'gpu', 'auto'] as const) {
  for (const route of ['default', 'native'] as const) {
    it(`SavedRouteRestart: ${mode} restores ${route} output in a fresh service`, async () => {
      const choice: OutputChoice = route === 'default' ? { kind: 'default' } : { kind: 'native', backend: 'pipewire', name: 'test-device' };
      async function runFresh(): Promise<void> {
        const defaultOutput = mock<SpeechOutput>();
        defaultOutput.play.mockReturnValue(7);
        let nativeEvent: ((kind: 'started' | 'ended' | 'failed') => void) | undefined;
        const driver = mock<NativeDriver>();
        driver.available.mockReturnValue(true);
        driver.play.mockImplementation((name, wav, event) => {
          expect(name).toBe('test-device');
          expect(wav).toBeInstanceOf(Uint8Array);
          nativeEvent = event;
          return true;
        });
        let service: SpeechService;
        const router = new SpeechOutputRouter({
          driver,
          discover: () =>
            Promise.resolve({ supported: true, devices: choice.kind === 'native' ? [{ choice, label: 'Test', available: true }] : [] }),
          choice: () => choice,
          defaultOutput,
          currentPage: () => 7,
          audioEvent: (event) => {
            service.audioEvent(event);
          },
        });
        const instance = compose(mode, router);
        service = instance.service;
        const pending = service.speak('First speech after restart.');
        if (route === 'native') {
          await vi.waitFor(
            () => {
              expect(driver.play.mock.calls).toHaveLength(1);
            },
            { interval: 5 },
          );
          expect(defaultOutput.play).not.toHaveBeenCalled();
          nativeEvent?.('ended');
        } else {
          await vi.waitFor(
            () => {
              expect(defaultOutput.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), expect.any(Number));
            },
            { interval: 5 },
          );
          expect(driver.play.mock.calls).toHaveLength(0);
          service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
          router.pageClosed(7);
        }
        await pending;
        const disposed = service.dispose();
        const worker = mode === 'cpu' ? instance.workers.cpu[0] : instance.workers.gpu[0];
        await vi.waitFor(
          () => {
            expect(worker?.terminate).toHaveBeenCalledOnce();
          },
          { interval: 5 },
        );
        worker?.exit();
        await disposed;
      }
      await runFresh();
      await runFresh();
    });
  }
}

it('RapidProofFlip: only the latest GPU request continues after a stale proof closes', async () => {
  const { service, output, workers, authorize, setMode } = compose('gpu');
  const firstProof = Promise.withResolvers<GpuCapabilityResult>();
  let firstSignal: AbortSignal | undefined;
  authorize.mockImplementationOnce((signal) => {
    firstSignal = signal;
    return firstProof.promise;
  });
  const first = service.speak('First GPU request.');
  await vi.waitFor(
    () => {
      expect(authorize).toHaveBeenCalledOnce();
    },
    { interval: 5 },
  );
  setMode('cpu');
  await first;
  const second = service.speak('Transient CPU request.');
  setMode('gpu');
  await second;
  const latest = service.speak('Latest GPU request.');
  expect(firstSignal?.aborted).toBe(true);
  expect(authorize).toHaveBeenCalledOnce();
  expect(workers.cpu).toHaveLength(0);
  expect(workers.gpu).toHaveLength(0);
  firstProof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await finish(service, output, latest, 3);
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(workers.cpu).toHaveLength(0);
  expect(workers.gpu).toHaveLength(1);
  expect(output.play.mock.calls.map(([id]) => id)).toEqual([3]);
});

it('AutoFallback: a failed GPU proof selects CPU and plays the first request', async () => {
  const { service, output, workers, authorize } = compose('auto');
  authorize.mockResolvedValueOnce({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await finish(service, output, service.speak('Automatic CPU fallback.'), 1);
  expect(workers.cpu).toHaveLength(1);
  expect(workers.gpu).toHaveLength(0);
});

it('DisposeProof: disposal aborts a proof and waits for its actual close', async () => {
  const { service, output, workers, authorize } = compose('gpu');
  const proof = Promise.withResolvers<GpuCapabilityResult>();
  let signal: AbortSignal | undefined;
  authorize.mockImplementationOnce((value) => {
    signal = value;
    return proof.promise;
  });
  const pending = service.speak('Pending proof.');
  await vi.waitFor(
    () => {
      expect(authorize).toHaveBeenCalledOnce();
    },
    { interval: 5 },
  );
  let disposed = false;
  const disposal = service.dispose().then(() => {
    disposed = true;
  });
  await pending;
  expect(signal?.aborted).toBe(true);
  await Promise.resolve();
  expect(disposed).toBe(false);
  expect(workers.cpu).toHaveLength(0);
  expect(workers.gpu).toHaveLength(0);
  proof.resolve({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await disposal;
  expect(disposed).toBe(true);
  expect(output.play).not.toHaveBeenCalled();
});

it('FreshGpuPreview: GPU failure followed by CPU and GPU selection obtains a fresh proof for the first preview', async () => {
  const { service, output, authorize, setMode, workers } = compose('gpu');
  authorize.mockResolvedValueOnce({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  await service.preview();
  expect(service.localComputeUsable()).toBe(false);
  setMode('cpu');
  setMode('gpu');
  expect(service.computeState()).toMatchObject({ requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  expect(service.localComputeUsable()).toBe(true);
  await finish(service, output, service.preview(), 2);
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(workers.gpu).toHaveLength(1);
});

it('BusyGpuCheck: a settings check during GPU playback does not overwrite verified health', async () => {
  const { service, output, workers } = compose('gpu');
  const speech = service.speak('GPU playback.');
  await vi.waitFor(
    () => {
      expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), expect.any(Number));
    },
    { interval: 5 },
  );
  const before = service.computeState();
  expect(before).toMatchObject({ actualBackend: 'gpu', gpuCheck: { phase: 'ready' } });
  const operation = vi.fn().mockResolvedValue({ phase: 'ready' });
  expect(await service.checkGpu(operation, new AbortController().signal)).toEqual({ phase: 'unavailable', reason: 'busy' });
  expect(operation).not.toHaveBeenCalled();
  expect(service.computeState()).toEqual(before);
  expect(service.localComputeUsable()).toBe(true);
  expect(workers.gpu).toHaveLength(1);
  await finish(service, output, speech, 1);
});
