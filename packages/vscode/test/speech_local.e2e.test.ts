import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { LocalSynthesisClient, type LocalListener, type WorkerLike } from '../src/speech_local_client';
import { LOCAL_REQUEST } from '../src/speech_local_protocol';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { SpeechEngine, SpeechTokens } from '../src/speech_synthesis';
import { SpeechWorkerHost } from '../src/speech_worker_host';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

/** Samples of an audible half-second tone, so the real encoder accepts the fake engine's output. */
const SAMPLES = Float32Array.from({ length: 12_000 }, (_, index) => Math.sin(index / 10) / 2);

/** The fake model: its load and inference can be held or failed by the test. */
const engine = {
  loads: 0,
  failLoad: false,
  gate: undefined as PromiseWithResolvers<void> | undefined,
  texts: [] as string[],
};

/** Loads the fake model through the host's real load path. */
function loadEngine(): Promise<SpeechEngine<SpeechTokens>> {
  engine.loads++;
  if (engine.failLoad) return Promise.reject(new Error('secret model path'));
  return Promise.resolve({
    phonemize: (text) => {
      engine.texts.push(text);
      return Promise.resolve('a');
    },
    tokenize: () => ({ dims: [1, 5] }),
    generate: async () => {
      await engine.gate?.promise;
      return { samples: SAMPLES, rate: 24_000 };
    },
  });
}

/** A worker that runs the real host in this thread and clones every message like a worker thread would. */
class InProcessWorker implements WorkerLike {
  static made: InProcessWorker[] = [];
  readonly terminate = vi.fn(() => Promise.resolve(0));
  private readonly listeners = new Map<string, (value: unknown) => void>();
  private readonly host = new SpeechWorkerHost(loadEngine, (message) => {
    queueMicrotask(() => {
      this.listeners.get('message')?.(structuredClone(message));
    });
  });
  constructor() {
    InProcessWorker.made.push(this);
  }
  postMessage(message: unknown): void {
    const request = structuredClone(LOCAL_REQUEST.parse(message));
    queueMicrotask(() => {
      void this.host.receive(request);
    });
  }
  on(event: string, listener: (value: unknown) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  /** The thread ends, as the operating system would report it. */
  exit(): void {
    this.listeners.get('exit')?.(0);
  }
}

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const arch = Object.getOwnPropertyDescriptor(process, 'arch');

/** Composes the real service, client and host over the in-process worker. */
function compose() {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    createLocal: (listener: LocalListener) => new LocalSynthesisClient({ spawn: () => new InProcessWorker(), listener }),
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  return { service, output };
}

/** Plays a unit to its natural end. */
async function finish(service: SpeechService, output: MockProxy<SpeechOutput>, gate: Promise<void>, id: number): Promise<void> {
  await vi.waitFor(() => {
    expect(output.play).toHaveBeenCalledWith(id, expect.any(Uint8Array), expect.any(Number));
  });
  expect(service.audioEvent({ id, pageId: 7, event: 'started' })).toBeUndefined();
  expect(service.audioEvent({ id, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
}

beforeEach(() => {
  InProcessWorker.made = [];
  engine.loads = 0;
  engine.failLoad = false;
  engine.gate = undefined;
  engine.texts = [];
  vi.mocked(installedSpeechModel).mockResolvedValue('/model');
  vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
});
afterEach(() => {
  vi.resetAllMocks();
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
});

describe('local synthesis, composed from the service to the host', () => {
  it('HealthyProgress: two units share one worker and one model load, each with real encoded audio', async () => {
    const { service, output } = compose();
    const first = service.speak('First unit.');
    await finish(service, output, first, 1);
    const second = service.speak('Second unit.');
    await finish(service, output, second, 2);
    expect(engine.loads).toBe(1);
    expect(InProcessWorker.made).toHaveLength(1);
    expect(engine.texts).toEqual(['First unit.', 'Second unit.']);
    expect(output.play).toHaveBeenCalledTimes(2);
    const wav = output.play.mock.calls[0]?.[1];
    expect(wav?.length).toBe(44 + (SAMPLES.length + 14_400) * 2);
  });

  it('NoCanceledResume: a canceled inference keeps the worker owned, its result is discarded, and the warm worker is reused', async () => {
    const { service, output } = compose();
    engine.gate = Promise.withResolvers<void>();
    const first = service.speak('Canceled unit.');
    await vi.waitFor(() => {
      expect(engine.texts).toEqual(['Canceled unit.']);
    });
    service.cancel();
    await first;
    await service.speak('Refused unit.');
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
    expect(engine.texts).toEqual(['Canceled unit.']);
    engine.gate.resolve();
    engine.gate = undefined;
    // The canceled inference returns on its own; give the worker thread time to deliver and the client to discard it.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const third = service.speak('Reused worker.');
    await finish(service, output, third, 3);
    expect(output.play).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
    expect(engine.texts).toEqual(['Canceled unit.', 'Reused worker.']);
    expect(engine.loads).toBe(1);
  });

  it('TruthfulUnavailable: a fatal load error ends the unit, keeps the slot until exit, and replays nothing on the next request', async () => {
    const { service, output } = compose();
    engine.failLoad = true;
    const first = service.speak('Failing unit.');
    await first;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Local speech stopped. Retry setup.');
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
    expect(JSON.stringify(output.status.mock.calls)).not.toContain('secret');
    const worker = InProcessWorker.made[0];
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
    await service.speak('Too early.');
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
    expect(InProcessWorker.made).toHaveLength(1);
    worker?.exit();
    engine.failLoad = false;
    const retry = service.speak('Retried unit.');
    await finish(service, output, retry, 3);
    expect(InProcessWorker.made).toHaveLength(2);
    expect(engine.loads).toBe(2);
    expect(engine.texts).toEqual(['Retried unit.']);
  });
});
