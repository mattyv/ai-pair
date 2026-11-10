// The service and real synthesis clients share fake transports and a fake output; no hardware or provider is used.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { LocalSynthesisClient, type LocalListener, type WorkerLike } from '../src/speech_local_client';
import { LOCAL_CAPABILITIES, LOCAL_PROTOCOL_VERSION, LOCAL_REQUEST, LOCAL_RESPONSE } from '../src/speech_local_protocol';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { GpuLaunchCapability } from '../src/speech_gpu_client';
import type { GpuCapabilityResult } from '../src/speech_gpu_capability';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { encodeTempoWav } from '../src/speech_tempo_pcm';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

/** A valid one-second silent WAV, delivered only to the fake output. */
const WAV = encodeTempoWav(new Int16Array(24_000), false).wav;

/** A worker whose retirement and operating-system exit are separately controlled. */
class Worker implements WorkerLike {
  readonly terminate = vi.fn(() => Promise.resolve(0));
  readonly requests: string[] = [];
  private readonly listeners = new Map<string, (value: unknown) => void>();
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  postMessage(value: unknown): void {
    const request = LOCAL_REQUEST.parse(value);
    this.requests.push(request.type);
    if (request.type === 'shutdown') return;
    const response =
      request.type === 'init'
        ? { type: 'ready', version: LOCAL_PROTOCOL_VERSION, epoch: request.epoch, capabilities: LOCAL_CAPABILITIES }
        : {
            type: 'result',
            version: LOCAL_PROTOCOL_VERSION,
            epoch: request.epoch,
            id: request.id,
            part: request.part,
            wav: WAV,
            durationMs: 1000,
          };
    queueMicrotask(() => {
      this.listeners.get('message')?.(LOCAL_RESPONSE.parse(response));
    });
  }
  /** Delivers the actual exit after termination has already been requested. */
  exit(): void {
    this.listeners.get('exit')?.(0);
  }
}

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const arch = Object.getOwnPropertyDescriptor(process, 'arch');
const services: SpeechService[] = [];

/** Composes both real clients with independent, manually reaped fake workers. */
function compose() {
  let mode: 'cpu' | 'gpu' = 'cpu';
  const workers: Record<'cpu' | 'gpu', Worker[]> = { cpu: [], gpu: [] };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const capability = mock<GpuLaunchCapability>({ modelDirectory: '/gpu-model' });
  const authorize = vi.fn<() => Promise<GpuCapabilityResult>>().mockResolvedValue({ check: { phase: 'ready' }, capability });
  function factory(kind: 'cpu' | 'gpu', listener: LocalListener): LocalSynthesisClient {
    return new LocalSynthesisClient({
      listener,
      spawn: () => {
        const worker = new Worker();
        workers[kind].push(worker);
        return worker;
      },
    });
  }
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
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
    authorize,
    setMode: (value: 'cpu' | 'gpu') => {
      mode = value;
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
  await vi.waitFor(() => {
    expect(output.play).toHaveBeenCalledWith(id, expect.any(Uint8Array), 1000);
  });
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
  for (const service of services.splice(0)) service.dispose();
  vi.resetAllMocks();
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
});

it('HandoffAfterReap: the same request switches CPU to GPU and back only after each real client sees exit', async () => {
  const { service, output, workers, authorize, setMode } = compose();
  await finish(service, output, service.speak('CPU first.'), 1);
  const cpu = workers.cpu[0];
  expect(cpu).toBeDefined();
  setMode('gpu');
  const gpuRequest = service.speak('GPU next.');
  await vi.waitFor(() => {
    expect(cpu?.terminate).toHaveBeenCalledOnce();
  });
  expect(authorize).not.toHaveBeenCalled();
  expect(workers.gpu).toHaveLength(0);
  expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
  cpu?.exit();
  await finish(service, output, gpuRequest, 2);
  expect(authorize).toHaveBeenCalledOnce();
  const gpu = workers.gpu[0];
  expect(gpu).toBeDefined();
  setMode('cpu');
  const cpuRequest = service.speak('CPU again.');
  await vi.waitFor(() => {
    expect(gpu?.terminate).toHaveBeenCalledOnce();
  });
  expect(workers.cpu).toHaveLength(1);
  expect(output.status).not.toHaveBeenCalledWith(3, 'unavailable', expect.any(String));
  gpu?.exit();
  await finish(service, output, cpuRequest, 3);
  expect(workers.cpu).toHaveLength(2);
});

it('HandoffAfterReap: a warm GPU switches to CPU within the same request only after exit', async () => {
  const { service, output, workers, setMode } = compose();
  setMode('gpu');
  await finish(service, output, service.speak('GPU first.'), 1);
  const gpu = workers.gpu[0];
  expect(gpu).toBeDefined();
  setMode('cpu');
  const request = service.speak('CPU next.');
  await vi.waitFor(() => {
    expect(gpu?.terminate).toHaveBeenCalledOnce();
  });
  expect(workers.cpu).toHaveLength(0);
  expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
  gpu?.exit();
  await finish(service, output, request, 2);
  expect(workers.cpu).toHaveLength(1);
});

it('FailedHandoffRecovery: after failed GPU authorization a later CPU request works without replaying the failed unit', async () => {
  const { service, output, workers, authorize, setMode } = compose();
  await finish(service, output, service.speak('CPU first.'), 1);
  authorize.mockResolvedValueOnce({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  setMode('gpu');
  const failed = service.speak('GPU unavailable.');
  await vi.waitFor(() => {
    expect(workers.cpu[0]?.terminate).toHaveBeenCalledOnce();
  });
  expect(authorize).not.toHaveBeenCalled();
  workers.cpu[0]?.exit();
  await failed;
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
  expect(output.play).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
  expect(workers.gpu).toHaveLength(0);
  setMode('cpu');
  await finish(service, output, service.speak('CPU recovers.'), 3);
  expect(workers.cpu).toHaveLength(2);
});
