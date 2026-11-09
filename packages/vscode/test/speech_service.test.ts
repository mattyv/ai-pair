import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { LOCAL_PROTOCOL_VERSION, LOCAL_REQUEST } from '../src/speech_local_protocol';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type {
  LocalClientState,
  LocalListener,
  LocalSynthesisOutcome,
  LocalSynthesisPort,
  LocalSynthesisRequest,
} from '../src/speech_local_client';
import type { ElevenLabsSpeechPort, LocalSpeechFailureReason, SpeechSettings } from '../src/speech_types';
import { decodeSpeechWav, encodeTempoWav } from '../src/speech_tempo_pcm';

const fake = vi.hoisted(() => {
  const Worker = vi.fn();
  /** The inert stand-in for the real client, used by every service built without an injected one. */
  class LocalSynthesisClient {
    static made: Array<{ spawn: (modelPath: string) => unknown; listener: unknown }> = [];
    constructor(options: { spawn: (modelPath: string) => unknown; listener: unknown }) {
      LocalSynthesisClient.made.push(options);
    }
    state(): string {
      return 'cold';
    }
    busy(): boolean {
      return false;
    }
    load(): void {}
    synthesize(): Promise<unknown> {
      return Promise.resolve({ status: 'failed', reason: 'unavailable' });
    }
    cancel(): void {}
    retire(): void {}
  }
  return { Worker, LocalSynthesisClient };
});
vi.mock('node:worker_threads', () => ({ Worker: fake.Worker }));
vi.mock('../src/speech_local_client', () => ({ LocalSynthesisClient: fake.LocalSynthesisClient }));
vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));
vi.mock('../src/speech_tempo_pcm', () => ({ decodeSpeechWav: vi.fn(), encodeTempoWav: vi.fn() }));
vi.mock('../src/speech_segments', () => ({
  speechSegments: vi.fn((text: string) => text.match(/[^.!?]+[.!?]\s*/gu) ?? [text]),
}));

/** Checks a callback captured from the timer fake. */
function isTimerCallback(value: unknown): value is () => void {
  return typeof value === 'function';
}

/** Lets model discovery and worker initialization settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

/** Keeps the process host settings so each test can restore them. */
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');

/** One request the service made of the local engine, which the test settles by hand. */
interface LocalCall {
  request: LocalSynthesisRequest;
  settle: (outcome: LocalSynthesisOutcome) => void;
  returned: boolean;
  canceled: boolean;
}

/** A typed fake local engine whose lifecycle events the test raises; it follows the client's documented contract. */
class LocalDouble {
  readonly port = mock<LocalSynthesisPort>();
  readonly calls: LocalCall[] = [];
  phase: LocalClientState = 'cold';
  listener?: LocalListener;

  constructor() {
    this.port.state.mockImplementation(() => this.phase);
    this.port.busy.mockImplementation(() => this.calls.some((call) => !call.returned));
    this.port.load.mockImplementation((modelPath) => {
      expect(modelPath).toBeTypeOf('string');
      this.phase = 'loading';
    });
    this.port.synthesize.mockImplementation((request) => {
      // The fake accepts only what the real client's protocol would send.
      LOCAL_REQUEST.parse({ type: 'synthesize', version: LOCAL_PROTOCOL_VERSION, epoch: 1, ...request });
      const outcome = Promise.withResolvers<LocalSynthesisOutcome>();
      this.calls.push({ request, settle: outcome.resolve, returned: false, canceled: false });
      return outcome.promise;
    });
    this.port.cancel.mockImplementation(() => {
      for (const call of this.calls) {
        if (!call.returned && !call.canceled) {
          call.canceled = true;
          call.settle({ status: 'failed', reason: 'canceled' });
        }
      }
    });
    this.port.retire.mockImplementation((reason) => {
      this.retired(reason);
    });
  }

  /** Makes the factory the service receives. */
  factory = (listener: LocalListener): LocalSynthesisPort => {
    this.listener = listener;
    return this.port;
  };

  /** The worker reported valid capabilities. */
  ready(): void {
    this.phase = 'ready';
    this.listener?.ready();
  }

  /** Returns the audio of the oldest outstanding request for the unit and part, then lets promises settle. */
  async audio(id: number, part = 0, durationMs = 1000, wav = new Uint8Array(44)): Promise<void> {
    this.take(id, part)?.settle({ status: 'audio', wav, durationMs });
    await settle();
  }

  /** The host reported a synthesis failure for the unit and part. */
  async failure(id: number, part = 0): Promise<void> {
    this.take(id, part)?.settle({ status: 'failed', reason: 'synthesis' });
    await settle();
  }

  /** The worker was retired: it keeps the slot until released; its pending request fails. */
  retired(reason: LocalSpeechFailureReason): void {
    if (this.phase === 'cold' || this.phase === 'retiring') return;
    this.phase = 'retiring';
    for (const call of this.calls) {
      if (!call.returned && !call.canceled) call.settle({ status: 'failed', reason });
      call.returned = true;
    }
    this.listener?.retired(reason);
  }

  /** The retired worker has exited. */
  released(): void {
    this.phase = 'cold';
  }

  /** Requests whose unit and part match, excluding those the worker already returned. */
  private take(id: number, part: number): LocalCall | undefined {
    const call = this.calls.find((candidate) => !candidate.returned && candidate.request.id === id && candidate.request.part === part);
    if (call !== undefined) call.returned = true;
    return call;
  }
}

/** The local engine of the service most recently built by a test. */
let local = new LocalDouble();

/** Starts a new local engine fake for the next service. */
function newLocal(): LocalDouble {
  local = new LocalDouble();
  return local;
}

/** Makes a service with a live page and local preferences. */
function harness(enabled = true, computeMode: () => 'cpu' | 'auto' | 'gpu' = () => 'cpu') {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const double = newLocal();
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    createLocal: double.factory,
    computeMode,
    settings: () => ({ enabled, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  return { service, output, local: double };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.LocalSynthesisClient.made.length = 0;
  local = new LocalDouble();
  vi.mocked(installedSpeechModel).mockResolvedValue('/model');
  vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  if (originalPlatform !== undefined) Object.defineProperty(process, 'platform', originalPlatform);
  if (originalArch !== undefined) Object.defineProperty(process, 'arch', originalArch);
});

describe('SpeechService', () => {
  it('uses a supported test host even when the test process is not Linux', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const { service } = harness();
      const gate = service.speak('Hello.');
      await settle();
      expect(local.port.load).toHaveBeenCalledWith('/model');
      service.cancel();
      await gate;
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'platform', original);
    }
  });

  it('defaults to silent behavior when disabled', async () => {
    const { service, output } = harness(false);
    await service.speak('Hello.');
    expect(local.port.load).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('matches generation and page acknowledgements before resolving speech', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    expect(local.port.load).toHaveBeenCalledWith('/model');
    local.ready();
    expect(local.calls.map((call) => call.request)).toEqual([{ id: 1, part: 0, final: true, text: 'Hello.', voice: 'af_heart', speed: 1 }]);
    await local.audio(1);
    expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    expect(service.audioEvent({ id: 1, pageId: 8, event: 'ended' })).toBeUndefined();
    await settle();
    expect(done).toBe(false);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'started' })).toBeUndefined();
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
    await gate;
    expect(done).toBe(true);
  });

  it('retains prepared audio during pause and never revives canceled audio', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    service.pause();
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    service.cancel();
    await gate;
    service.resume();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('a retired worker ends its unit with a fixed reason and a late output changes nothing', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    local.retired('timeout');
    await gate;
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'timeout');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Local speech stopped. Retry setup.');
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
  });
});

describe('SpeechService lifecycle', () => {
  it('does not start work when a preparing notification synchronously cancels it', async () => {
    const { service, output } = harness();
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'preparing') service.cancel();
    });
    await service.speak('Hello.');
    expect(installedSpeechModel).not.toHaveBeenCalled();
    expect(local.port.load).not.toHaveBeenCalled();
  });

  it('does not post audio when its preparing notification synchronously cancels it', async () => {
    const { service, output } = harness();
    let preparations = 0;
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'preparing' && ++preparations === 2) service.cancel();
    });
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    await gate;
    expect(output.play).not.toHaveBeenCalled();
  });

  it('stops an audio post if cancellation happens while the page accepts it', async () => {
    const { service, output } = harness();
    output.play.mockImplementation(() => {
      service.cancel();
      return 7;
    });
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    await gate;
    expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
  });

  it('does not retry synthesis while a canceled worker job is still running', async () => {
    const { service, output } = harness();
    const first = service.speak('First.');
    await settle();
    local.ready();
    service.cancel();
    await first;
    await service.speak('Second.');
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
    expect(local.calls).toHaveLength(1);
    await local.audio(1);
    const third = service.speak('Third.');
    expect(local.calls.map((call) => call.request)).toEqual([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 3, text: 'Third.' }),
    ]);
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    service.cancel();
    await third;
  });

  it('NoCanceledResume: a unit canceled during model loading leaves the load to the worker watchdog', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    service.cancel();
    await gate;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(local.port.cancel).toHaveBeenCalled();
    expect(local.port.retire).not.toHaveBeenCalled();
    expect(local.calls).toHaveLength(0);
  });

  it('the unit deadline retires a worker that is still loading and falls back to reading', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await gate;
    expect(local.port.retire).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('OneEngine: refuses a new unit while a retired worker has not exited, then loads a fresh one', async () => {
    const { service, output } = harness();
    const first = service.speak('First.');
    await settle();
    local.ready();
    service.cancel();
    await first;
    local.retired('timeout');
    await service.speak('Second.');
    expect(local.port.load).toHaveBeenCalledTimes(1);
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    local.released();
    const third = service.speak('Third.');
    await settle();
    expect(local.port.load).toHaveBeenCalledTimes(2);
    service.cancel();
    await third;
  });

  it('shows preparation again when a synthesis pause clears', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    service.pause();
    service.resume();
    expect(output.status).toHaveBeenLastCalledWith(1, 'preparing');
    service.cancel();
    await gate;
  });

  it('does not extend the playback watchdog for duplicate started events', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(true);
  });

  it('does not count paused time against the playback watchdog', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    service.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    service.resume();
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await gate;
    expect(done).toBe(true);
  });

  it.each(['cancel', 'pageClosed'] as const)('never accepts a late ended event after playback starts and %s occurs', async (reason) => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    if (reason === 'cancel') service.cancel();
    else service.pageClosed(7);
    await gate;
    expect(output.status).toHaveBeenLastCalledWith(1, 'idle');
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
  });

  it('cancels on page closure and ignores a late page acknowledgement', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.pageClosed(7);
    await gate;
    expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    expect(output.status).not.toHaveBeenCalledWith(1, 'speaking');
  });

  it('uses text-only fallback when model or page is missing and for invalid worker audio', async () => {
    const missing = harness();
    vi.mocked(installedSpeechModel).mockResolvedValueOnce(undefined);
    await missing.service.speak('Hello.');
    expect(missing.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('Download the Kokoro model'));
    const noPage = harness();
    noPage.output.play.mockReturnValue(undefined);
    const gate = noPage.service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    await gate;
    expect(noPage.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('panel'));
    const invalid = noPage.service.speak('Again.');
    await local.audio(2, 0, 1000, new Uint8Array(43));
    await invalid;
    expect(noPage.output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('invalid'));
  });
});

describe('SpeechService failures and races', () => {
  it('falls back for an invalid persisted voice or speed', async () => {
    for (const settings of [
      { enabled: true, provider: 'kokoro' as const, voice: 'invalid', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
      { enabled: true, provider: 'kokoro' as const, voice: 'af_heart', speed: 3, elevenLabsVoice: '', elevenLabsSpeed: 1 },
    ]) {
      const output = mock<SpeechOutput>();
      output.prepare = undefined;
      const service = new SpeechService({
        runtimeDirectory: '/runtime',
        storageDirectory: '/storage',
        localDesktop: true,
        output,
        createLocal: newLocal().factory,
        settings: () => settings,
      });
      await service.speak('Hello.');
      expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('supported'));
      expect(local.port.load).not.toHaveBeenCalled();
    }
  });

  it('reports a package without a bundled runtime as unavailable', async () => {
    const { service, output } = harness();
    vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(false);
    const gate = service.speak('Hello.');
    await settle();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('runtime'));
    expect(local.port.load).not.toHaveBeenCalled();
    await gate;
  });

  it.each([
    ['darwin', 'arm64'],
    ['win32', 'x64'],
    ['linux', 'arm64'],
  ])('leaves speech unavailable on %s %s', async (platform, arch) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      createLocal: newLocal().factory,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(local.port.load).not.toHaveBeenCalled();
  });

  it('explains unsupported extension hosts without starting a worker', async () => {
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: false,
      output,
      createLocal: newLocal().factory,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(local.port.load).not.toHaveBeenCalled();
  });

  it('resumes a prepared waveform only when the global pause clears', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    service.pause();
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    service.resume();
    expect(output.play).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.pause();
    expect(output.control).toHaveBeenCalledWith(1, 7, 'pause');
    service.resume();
    expect(output.control).toHaveBeenCalledWith(1, 7, 'resume');
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'idle');
  });

  it('keeps the startup watchdog paused if playback acknowledges while paused', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.pause();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(output.status).toHaveBeenLastCalledWith(1, 'paused');
    service.resume();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it.each(['worker_error', 'worker_exit'] as const)('falls back when the worker is retired for %s', async (reason) => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.retired(reason);
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', reason);
  });

  it('keeps a loading worker after cancellation but ignores the old request', async () => {
    const { service } = harness();
    const first = service.speak('Old.');
    await settle();
    service.cancel();
    await first;
    const next = service.speak('New.');
    await settle();
    expect(local.port.load).toHaveBeenCalledTimes(1);
    local.ready();
    expect(local.calls.map((call) => call.request)).toEqual([expect.objectContaining({ id: 2, text: 'New.' })]);
    service.cancel();
    await next;
  });

  it('ignores a discovery rejection after that generation was canceled', async () => {
    const discovery = Promise.withResolvers<string | undefined>();
    vi.mocked(installedSpeechModel).mockReturnValueOnce(discovery.promise);
    const { service, output } = harness();
    const gate = service.speak('Old.');
    await settle();
    service.cancel();
    await gate;
    discovery.reject(new Error('private'));
    await settle();
    expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('handles a client that retires a worker it could not send a request to', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    local.retired('worker_error');
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('does not complete a newer speech unit when an old timeout is delivered late', async () => {
    const { service, output } = harness();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const first = service.speak('Old.');
    const callback: unknown = timers.mock.calls[0]?.[0];
    service.cancel();
    await first;
    const second = service.speak('New.');
    if (!isTimerCallback(callback)) throw new Error('No timeout callback');
    callback();
    expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
    service.cancel();
    await second;
    timers.mockRestore();
  });

  it('survives cancellation reentered from an unavailable notification', async () => {
    const { service, output } = harness();
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'unavailable') service.cancel();
    });
    vi.mocked(installedSpeechModel).mockResolvedValueOnce(undefined);
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'idle');
  });

  it('accepts worker readiness after its requesting unit was canceled', async () => {
    const { service, output } = harness();
    const first = service.speak('Old.');
    await settle();
    service.cancel();
    await first;
    local.ready();
    const next = service.speak('New.');
    expect(local.calls.map((call) => call.request)).toEqual([expect.objectContaining({ id: 2, text: 'New.' })]);
    await local.failure(1);
    expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
    service.cancel();
    await next;
  });

  it('handles cancellation during a failed page post and idle controls', async () => {
    const { service, output } = harness();
    service.pause();
    service.resume();
    service.cancel();
    output.play.mockImplementation(() => {
      service.cancel();
      return undefined;
    });
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    await gate;
    expect(output.control).not.toHaveBeenCalled();
    service.dispose();
    service.dispose();
  });

  it('keeps the watchdog remaining time after a duplicate pause', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.pause();
    service.pause();
    service.resume();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it('drops a canceled discovery result and reports discovery failure safely', async () => {
    const discovery = Promise.withResolvers<string | undefined>();
    vi.mocked(installedSpeechModel).mockReturnValueOnce(discovery.promise);
    const first = harness();
    const gate = first.service.speak('Old.');
    await settle();
    first.service.cancel();
    await gate;
    discovery.resolve('/model');
    await settle();
    expect(local.port.load).not.toHaveBeenCalled();
    const next = harness();
    vi.mocked(installedSpeechModel).mockRejectedValueOnce(new Error('private path'));
    await next.service.speak('New.');
    expect(next.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('could not start'));
    expect(JSON.stringify(next.output.status.mock.calls)).not.toContain('private path');
  });

  it('TruthfulUnavailable: a worker that cannot load its model ends the unit with the model_load category', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.retired('model_load');
    await gate;
    local.released();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
    expect(local.calls).toHaveLength(0);
  });

  it('resumes an audio element that has not acknowledged starting yet', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    service.pageClosed(8);
    service.pause();
    service.resume();
    expect(output.status).toHaveBeenLastCalledWith(1, 'preparing');
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it('falls back when the client cannot start the worker, using only the allowlisted error code', async () => {
    const { service, output } = harness();
    local.port.load.mockImplementationOnce(() => {
      throw Object.assign(new Error('/private/path'), { code: 'EACCES' });
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('could not start'));
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_permission');
    expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
  });

  it('ignores a failed start whose unit was canceled meanwhile', async () => {
    const { service, output } = harness();
    local.port.load.mockImplementationOnce(() => {
      service.cancel();
      throw new Error('late');
    });
    await service.speak('Hello.');
    expect(output.localDiagnostic).not.toHaveBeenCalled();
    expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('falls back on a retired worker and on audio play failures', async () => {
    const first = harness();
    const gate = first.service.speak('Hello.');
    await settle();
    local.retired('worker_error');
    await gate;
    expect(first.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));

    const second = harness();
    second.output.play.mockImplementation(() => {
      throw new Error('closed page');
    });
    const next = second.service.speak('Hello.');
    await settle();
    local.ready();
    await local.audio(1);
    await next;
    expect(second.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('Audio'));
  });

  it('surfaces a synthesis failure and page errors without releasing another generation', async () => {
    const { service, output } = harness();
    const first = service.speak('One.');
    await settle();
    local.ready();
    await local.failure(1);
    await first;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Could not speak this text. Continue reading it.');
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'synthesis');
    const next = service.speak('Two.');
    await local.audio(2);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'failed' })).toBeUndefined();
    expect(service.audioEvent({ id: 2, pageId: 7, event: 'failed' })).toBe('failed');
    await next;
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('Preview'));
  });

  it('allows preview while disabled and gives live speech priority over preview', async () => {
    const disabled = harness(false);
    const preview = disabled.service.preview();
    await settle();
    expect(local.port.load).toHaveBeenCalledTimes(1);
    disabled.service.cancel();
    await preview;

    const live = harness();
    const sample = live.service.preview();
    await settle();
    local.ready();
    const next = live.service.speak('Live.');
    await sample;
    await next;
    expect(live.output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
  });

  it('NoReplay: after a failure the next explicit request sends only its own text', async () => {
    const { service } = harness();
    const first = service.speak('Failed text.');
    await settle();
    local.ready();
    await local.failure(1);
    await first;
    const second = service.speak('Next text.');
    expect(local.calls.map((call) => call.request.text)).toEqual(['Failed text.', 'Next text.']);
    service.cancel();
    await second;
  });

  it('fails the unit visibly if the client refuses the request instead of waiting for the deadline', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.ready();
    local.calls[0]?.settle({ status: 'failed', reason: 'unavailable' });
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Could not speak this text. Continue reading it.');
  });

  it('disposes a worker and refuses new requests', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    service.dispose();
    await gate;
    expect(local.port.retire).toHaveBeenCalledExactlyOnceWith('worker_error');
    await service.speak('Later.');
    expect(local.port.load).toHaveBeenCalledTimes(1);
  });

  it('builds the packaged Node worker client when none is injected', () => {
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output: mock<SpeechOutput>(),
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    expect(service).toBeInstanceOf(SpeechService);
    const options = fake.LocalSynthesisClient.made[0];
    expect(options).toBeDefined();
    // The pinned phonemizer bridge reads the verified model directory from workerData.
    options?.spawn('/storage/speech/model');
    expect(fake.Worker).toHaveBeenCalledExactlyOnceWith('/runtime/worker.mjs', { workerData: { modelPath: '/storage/speech/model' } });
  });
});

describe('cloud narration', () => {
  it('sends the selected text once, and accepts only the current page ending', async () => {
    const cloud = mock<ElevenLabsSpeechPort>();
    cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    output.play.mockReturnValue(7);
    const service = new SpeechService({
      runtimeDirectory: '',
      storageDirectory: '',
      localDesktop: true,
      output,
      cloud,
      settings: () => ({
        enabled: true,
        provider: 'elevenlabs',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: 'voice-id',
        elevenLabsSpeed: 1.2,
      }),
    });
    const gate = service.speak('Exact selected text.');
    await settle();
    expect(cloud.synthesize.mock.calls).toHaveLength(1);
    expect(cloud.synthesize.mock.calls[0]?.[0]).toEqual({ text: 'Exact selected text.', voiceId: 'voice-id', speed: 1.2 });
    expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
    await gate;
  });

  it('aborts a canceled request and ignores its late output without queuing a successor', async () => {
    const cloud = mock<ElevenLabsSpeechPort>();
    const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
    cloud.synthesize.mockReturnValue(pending.promise);
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '',
      storageDirectory: '',
      localDesktop: true,
      output,
      cloud,
      settings: () => ({
        enabled: true,
        provider: 'elevenlabs',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: 'voice-id',
        elevenLabsSpeed: 1,
      }),
    });
    const gate = service.speak('First.');
    const signal = cloud.synthesize.mock.calls[0]?.[1];
    service.cancel();
    await gate;
    expect(signal?.aborted).toBe(true);
    await service.speak('Second.');
    expect(cloud.synthesize.mock.calls).toHaveLength(1);
    pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
    await settle();
    expect(output.play).not.toHaveBeenCalled();
  });
});

/** A cloud-only fixture with an explicitly selected nonsecret voice. */
function cloudHarness() {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const cloudDiagnostic = vi.fn<(reason: string) => void>();
  const settings = {
    enabled: true,
    provider: 'elevenlabs' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice-id',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud,
    cloudDiagnostic,
    settings: () => settings,
  });
  return { cloud, output, service, settings, cloudDiagnostic };
}

it('reports a categorized second failure and accepts the next narration', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(44), durationMs: 1000 });
  cloud.synthesize.mockRejectedValueOnce({ kind: 'rate', message: 'private provider response' });
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(44), durationMs: 1000 });
  const first = service.speak('First private text.');
  await settle();
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  await service.speak('Second private text.');
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('rate'));
  expect(cloudDiagnostic).toHaveBeenCalledWith('rate');
  const third = service.speak('Third private text.');
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(3);
  expect(output.play).toHaveBeenCalledTimes(2);
  service.audioEvent({ id: 3, pageId: 7, event: 'ended' });
  await third;
  expect(JSON.stringify(cloudDiagnostic.mock.calls)).not.toContain('private');
});

it.each([
  ['key', 'no_key', 'API key'],
  ['auth', 'auth', 'authorize'],
  ['rate', 'rate', 'rate limit'],
  ['network', 'network', 'service returned an error'],
  ['timeout', 'timeout', 'timed out'],
  ['invalid', 'invalid', 'invalid response or request'],
  ['unexpected', 'unknown', 'unavailable'],
])('reports the fixed %s cloud category without provider details', async (kind, reason, message) => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockRejectedValueOnce({ kind, message: 'private key and response' });
  await service.speak('private narration');
  expect(cloudDiagnostic).toHaveBeenCalledWith(reason);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining(message));
  expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
});

it('settles an unexpected canceled result without an unavailable banner', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockRejectedValueOnce({ kind: 'canceled' });
  await service.speak('Canceled.');
  expect(cloudDiagnostic).toHaveBeenCalledWith('canceled');
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
  expect(output.status).toHaveBeenCalledWith(1, 'idle');
});

it('ignores a synchronous provider throw after cancellation', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockImplementationOnce(() => {
    service.cancel();
    throw new Error('private');
  });
  await service.speak('Canceled.');
  expect(cloudDiagnostic).not.toHaveBeenCalled();
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
});

it('keeps failure handling working when diagnostics throw', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloudDiagnostic.mockImplementation(() => {
    throw new Error('private');
  });
  cloud.synthesize.mockRejectedValueOnce({ kind: 'network' });
  await service.speak('Failure.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('service returned an error'));
});

it('supports cloud on macOS without requiring the local runtime', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const { cloud, service } = cloudHarness();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Hello.');
  await settle();
  expect(local.port.load).not.toHaveBeenCalled();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('never invokes cloud when disabled or no cloud voice is selected', async () => {
  const { cloud, service, settings, output } = cloudHarness();
  settings.enabled = false;
  await service.speak('No send.');
  settings.enabled = true;
  settings.elevenLabsVoice = '';
  await service.speak('No voice.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('voice'));
});

it('keeps prepared cloud speech paused until resume and rejects stale page events', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.pause();
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
  service.resume();
  expect(output.play).toHaveBeenCalledOnce();
  expect(service.audioEvent({ id: 1, pageId: 8, event: 'ended' })).toBeUndefined();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('cancels cloud work when credentials change and discards the late response', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  const signal = cloud.synthesize.mock.calls[0]?.[1];
  service.invalidateCloud();
  await gate;
  expect(signal?.aborted).toBe(true);
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
});

it('releases a hung cloud request at its watchdog without reviving late output', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  await vi.advanceTimersByTimeAsync(20_000);
  await gate;
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('timed out'));
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
  expect(cloudDiagnostic.mock.calls).toEqual([['timeout']]);
});

it('falls back safely for invalid cloud audio and sanitized provider failures', async () => {
  const { cloud, service, output } = cloudHarness();
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(2), durationMs: 1000 });
  await service.speak('First.');
  cloud.synthesize.mockRejectedValueOnce(new Error('secret provider response'));
  await service.speak('Second.');
  expect(output.play).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.not.stringContaining('secret'));
});

it('rejects unknown providers without falling back or starting a request', async () => {
  const { cloud, service, settings, output } = cloudHarness();
  Object.assign(settings, { provider: 'unknown' });
  await service.speak('Do not send.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(local.port.load).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('provider'));
});

it('never sends cloud speech from a remote extension host', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: false,
    output,
    cloud,
    settings: () => ({ enabled: true, provider: 'elevenlabs', voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 }),
  });
  await service.speak('Do not send.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local desktop'));
});

it('keeps cloud audio independent of an invalid saved local voice', async () => {
  const { cloud, service, settings } = cloudHarness();
  settings.voice = 'old-invalid-local-voice';
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Cloud.');
  await settle();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('sanitizes synchronous provider failures', async () => {
  const { cloud, service, output } = cloudHarness();
  cloud.synthesize.mockImplementationOnce(() => {
    throw new Error('private');
  });
  await service.speak('Hello.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.not.stringContaining('private'));
});

it('allows an existing local speech unit to survive a cloud key change', async () => {
  const { service } = harness();
  const gate = service.speak('Local.');
  await settle();
  service.invalidateCloud();
  local.ready();
  await local.audio(1);
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('does not report a late rejected cloud request after cancellation', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  pending.reject(new Error('late'));
  await settle();
  expect(output.status).not.toHaveBeenCalled();
  expect(cloudDiagnostic).not.toHaveBeenCalled();
});

it('expires a canceled request that ignores abort, without another status update', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(output.status).not.toHaveBeenCalled();
  expect(cloudDiagnostic).not.toHaveBeenCalled();
});

it('does not let an idle local worker failure interrupt an active cloud unit', async () => {
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const cloud = mock<ElevenLabsSpeechPort>();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const settings = {
    enabled: true,
    provider: 'kokoro' as 'kokoro' | 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud,
    createLocal: newLocal().factory,
    settings: () => settings,
  });
  const localGate = service.speak('Local.');
  await settle();
  local.ready();
  await local.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await localGate;
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  local.retired('worker_error');
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('resolves the speech gate if cloud service disappears during the preparing callback', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const options = {
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud: cloud as ElevenLabsSpeechPort | undefined,
    settings: () => ({
      enabled: true,
      provider: 'elevenlabs' as const,
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'voice',
      elevenLabsSpeed: 1,
    }),
  };
  output.status.mockImplementation(() => {
    options.cloud = undefined;
  });
  const service = new SpeechService(options);
  await service.speak('Hello.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
});

it('blocks local speech on a non-glibc host while leaving cloud available', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const settings = {
    enabled: true,
    provider: 'kokoro' as 'kokoro' | 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    kokoroSupported: false,
    output,
    cloud,
    createLocal: newLocal().factory,
    settings: () => settings,
  });
  await service.speak('Local.');
  expect(local.port.load).not.toHaveBeenCalled();
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('uses local defaults for a preference saved before providers existed', async () => {
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const settings = { enabled: true, provider: 'kokoro' as const, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
  Reflect.deleteProperty(settings, 'provider');
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    createLocal: newLocal().factory,
    settings: () => settings,
  });
  const gate = service.speak('Local.');
  await settle();
  expect(local.port.load).toHaveBeenCalledTimes(1);
  service.cancel();
  await gate;
});

it('ignores a stale queued cloud watchdog after its request settles', async () => {
  const { cloud, service, output } = cloudHarness();
  const spy = vi.spyOn(globalThis, 'setTimeout');
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Hello.');
  const callback: unknown = spy.mock.calls[0]?.[0];
  await settle();
  output.status.mockClear();
  if (!isTimerCallback(callback)) throw new Error('No watchdog');
  callback();
  expect(output.status).not.toHaveBeenCalled();
  service.cancel();
  await gate;
});

it('classifies a native worker failure by code without exposing error text', async () => {
  const { service, output } = harness();
  local.port.load.mockImplementationOnce(() => {
    throw Object.assign(new Error('/private/lib secret text'), { code: 'ERR_DLOPEN_FAILED' });
  });
  const gate = service.speak('Synthetic.');
  await settle();
  await gate;
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_native');
  expect(JSON.stringify(vi.mocked(output.localDiagnostic)?.mock.calls)).not.toMatch(/private|secret/);
});

it('records a local worker-ready checkpoint before synthesis', async () => {
  const { service, output } = harness();
  const gate = service.speak('Synthetic.');
  await settle();
  local.ready();
  expect(output.localDiagnostic).toHaveBeenCalledWith('ready', undefined);
  service.cancel();
  await gate;
});

it.each([
  [{ code: 'ERR_MODULE_NOT_FOUND', message: '/private/file' }, 'worker_module'],
  [{ code: 'MODULE_NOT_FOUND', message: '/private/file' }, 'worker_module'],
  [{ code: 'EACCES', message: '/private/file' }, 'worker_permission'],
  [{ code: 'EPERM', message: '/private/file' }, 'worker_permission'],
  [{ code: 'SOME_UNKNOWN_CODE', message: '/private/file' }, 'worker_error'],
  [new Error('private detail'), 'worker_error'],
] as const)('classifies worker errors using only allowlisted codes', async (error, reason) => {
  const { service, output } = harness();
  const thrown: unknown = error;
  local.port.load.mockImplementationOnce(() => {
    throw thrown;
  });
  const gate = service.speak('Synthetic.');
  await settle();
  await gate;
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', reason);
  expect(JSON.stringify(vi.mocked(output.localDiagnostic)?.mock.calls)).not.toMatch(/private|SOME_UNKNOWN/);
});

it('reports the worker category the client gives for a retirement before and after readiness', async () => {
  const first = harness();
  const firstGate = first.service.speak('Synthetic.');
  await settle();
  local.retired('model_load');
  await firstGate;
  expect(first.output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
  const second = harness();
  const secondGate = second.service.speak('Synthetic.');
  await settle();
  local.ready();
  local.retired('worker_error');
  await secondGate;
  expect(second.output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_error');
});

it('does not let diagnostic callback failures interrupt local speech', async () => {
  const { service, output } = harness();
  vi.mocked(output.localDiagnostic)?.mockImplementation(() => {
    throw new Error('private diagnostic failure');
  });
  const gate = service.speak('Synthetic.');
  await settle();
  local.ready();
  await local.audio(1);
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('handles cloud audio page failures without reporting local runtime failures', async () => {
  for (const mode of ['throw', 'missing', 'failed', 'timeout'] as const) {
    const { cloud, service, output } = cloudHarness();
    cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
    if (mode === 'throw') {
      output.play.mockImplementationOnce(() => {
        throw new Error('page');
      });
    }
    if (mode === 'missing') output.play.mockReturnValueOnce(undefined);
    const gate = service.speak('Synthetic.');
    await settle();
    if (mode === 'failed') service.audioEvent({ id: 1, pageId: 7, event: 'failed' });
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(20_000);
    await gate;
    expect(output.localDiagnostic).not.toHaveBeenCalled();
  }
});

it('blocks provider synthesis when output admission rejects or returns unavailable', async () => {
  const { cloud, output, service } = cloudHarness();
  output.prepare = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('private'));
  await service.speak('One');
  await service.speak('Two');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Selected speech output is unavailable.');
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', 'Selected speech output is unavailable.');
  expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
});

it('starts the provider only after successful current admission', async () => {
  const { cloud, output, service } = cloudHarness();
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  cloud.synthesize.mockReturnValue(new Promise(() => {}));
  const gate = service.speak('One');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  pending.resolve(true);
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('times out admission and ignores its late success without sending text', async () => {
  const { cloud, output, service } = cloudHarness();
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const gate = service.speak('One');
  await vi.advanceTimersByTimeAsync(5000);
  await gate;
  pending.resolve(true);
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Selected speech output is unavailable.');
});

it('ignores canceled admission success or rejection after a replacement starts', async () => {
  const { cloud, output, service } = cloudHarness();
  const first = Promise.withResolvers<boolean>();
  const second = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = service.speak('One');
  service.cancel();
  await a;
  const b = service.speak('Two');
  first.reject(new Error('private'));
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  second.resolve(false);
  await b;
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
});

it('ignores a canceled admission timeout after a replacement starts', async () => {
  const { cloud, output, service } = cloudHarness();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  output.prepare = vi.fn(() => new Promise<boolean>(() => {}));
  const first = service.speak('Old');
  const callback: unknown = timers.mock.calls[0]?.[0];
  service.cancel();
  await first;
  const second = service.speak('New');
  if (!isTimerCallback(callback)) throw new Error('No admission timer');
  callback();
  expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  service.cancel();
  await second;
  timers.mockRestore();
});

it('does not let a canceled worker readiness bypass a newer pending output admission', async () => {
  const { service, output } = harness();
  const first = service.speak('Old');
  await settle();
  service.cancel();
  await first;
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const second = service.speak('New');
  local.ready();
  expect(local.calls).toHaveLength(0);
  pending.resolve(false);
  await second;
  expect(local.calls).toHaveLength(0);
});

it('starts the already-ready worker exactly once after the newer admission succeeds', async () => {
  const { service, output } = harness();
  const first = service.speak('Old');
  await settle();
  service.cancel();
  await first;
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const second = service.speak('New');
  local.ready();
  expect(local.calls).toHaveLength(0);
  pending.resolve(true);
  await settle();
  expect(local.calls.map((call) => call.request)).toEqual([{ id: 2, part: 0, final: true, text: 'New', voice: 'af_heart', speed: 1 }]);
  service.cancel();
  await second;
});

it('retires pending admission on cancel, timeout, and disposal before late results', async () => {
  for (const reason of ['cancel', 'timeout', 'dispose'] as const) {
    const { cloud, output, service } = cloudHarness();
    const pending = Promise.withResolvers<boolean>();
    const cancelOutput = vi.fn();
    Object.assign(output, { cancel: cancelOutput });
    output.prepare = vi.fn(() => pending.promise);
    const gate = service.speak('One');
    if (reason === 'cancel') service.cancel();
    else if (reason === 'dispose') service.dispose();
    else await vi.advanceTimersByTimeAsync(5000);
    await gate;
    expect(cancelOutput).toHaveBeenCalledWith(1);
    pending.resolve(true);
    await settle();
    expect(cloud.synthesize.mock.calls).toHaveLength(0);
  }
});

it('SentencePipeline waits for the first started acknowledgement before one lookahead and completes only after the final part', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First sentence. Second sentence.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  await settle();
  local.ready();
  expect(local.calls.at(-1)?.request).toEqual({
    id: 1,
    part: 0,
    final: false,
    text: 'First sentence. ',
    voice: 'af_heart',
    speed: 1,
  });
  await local.audio(1, 0);
  expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000, 0);
  expect(local.calls).toHaveLength(1);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  expect(local.calls.at(-1)?.request).toEqual({
    id: 1,
    part: 1,
    final: true,
    text: 'Second sentence.',
    voice: 'af_heart',
    speed: 1,
  });
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' })).toBeUndefined();
  expect(output.play).toHaveBeenCalledTimes(2);
  await settle();
  expect(done).toBe(false);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(done).toBe(false);
  service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
  expect(service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'ended' })).toBe('ended');
  await gate;
  expect(done).toBe(true);
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline does not dispatch the next part until its own started acknowledgement after pause and close', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second. Third.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  await local.audio(1, 1);
  service.pause();
  service.resume();
  expect(local.calls).toHaveLength(2);
  service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
  expect(local.calls).toHaveLength(3);
  service.cancel();
  await gate;
});

it('NoPausedDispatch: SentencePipeline holds first synthesis while paused during model loading', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  service.pause();
  local.ready();
  expect(local.calls).toHaveLength(0);
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline ignores a repeated part result without releasing the current inference', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(output.play).toHaveBeenCalledTimes(1);
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(2);
  service.cancel();
  await gate;
});

it('NoCanceledResume: SentencePipeline cancels a delayed lookahead on reply and ignores its result', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  service.cancel();
  await gate;
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline fails the whole unit if aggregate audio exceeds its bound', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0, 25_000);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 1, 16_000);
  await gate;
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Generated speech was invalid; continue reading.');
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline keeps paused model-ready speech pending past the playback-start deadline', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  await settle();
  service.pause();
  local.ready();
  await vi.advanceTimersByTimeAsync(21_000);
  expect(done).toBe(false);
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline does not launch lookahead if a status callback cancels the unit', async () => {
  const { service, output } = harness();
  output.parts = true;
  output.status.mockImplementation((id, state) => {
    if (id === 1 && state === 'speaking') service.cancel();
  });
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await gate;
  expect(local.calls).toHaveLength(1);
});

it('SentencePipeline fails an end acknowledgement before the part starts', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  expect(service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' })).toBe('failed');
  await gate;
  expect(local.calls).toHaveLength(1);
});

it('SentencePipeline keeps a finished lookahead paused until the current part retires and resumes', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 1);
  service.pause();
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(output.play).toHaveBeenCalledTimes(1);
  service.resume();
  expect(output.play).toHaveBeenCalledTimes(2);
  service.cancel();
  await gate;
});

it('SentencePipeline discards a late synthesis error after cancellation', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  service.cancel();
  await gate;
  await local.failure(1, 0);
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  expect(output.localDiagnostic).not.toHaveBeenCalledWith('failed', 'synthesis');
});

it('SentencePipeline resumes a model that is still loading without losing its watchdog', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  service.pause();
  service.resume();
  await vi.advanceTimersByTimeAsync(20_001);
  await gate;
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
});

it('SentencePipeline keeps the start watchdog frozen when admission completes while paused', async () => {
  const { service, output } = harness();
  output.parts = true;
  const admission = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValue(admission.promise);
  const gate = service.speak('First. Second.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  service.pause();
  admission.resolve(true);
  await settle();
  local.ready();
  await vi.advanceTimersByTimeAsync(21_000);
  expect(done).toBe(false);
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline does not synthesize if a ready diagnostic cancels the unit', async () => {
  const { service, output } = harness();
  output.parts = true;
  output.localDiagnostic = vi.fn((phase) => {
    if (phase === 'ready') service.cancel();
  });
  const gate = service.speak('First. Second.');
  await settle();
  local.ready();
  await gate;
  expect(local.calls).toHaveLength(0);
});

function tempoHarness(listeningSpeed: number, hasTempo = true, busy = vi.fn(() => false)) {
  const settings: SpeechSettings = {
    enabled: true,
    provider: 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1.2,
    listeningSpeed,
  };
  const wav = new Uint8Array(44);
  const synthesize = vi.fn().mockResolvedValue({ wav, durationMs: 1000 });
  const transform = vi.fn();
  const dispose = vi.fn().mockResolvedValue(undefined);
  const output: SpeechOutput = {
    play: vi.fn(() => 7),
    control: vi.fn<SpeechOutput['control']>(),
    status: vi.fn<SpeechOutput['status']>(),
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    settings: () => settings,
    output,
    cloud: { synthesize, voices: vi.fn() },
    ...(hasTempo ? { tempo: { transform, dispose, busy } } : {}),
  });
  return { service, settings, wav, synthesize, transform, dispose, output };
}

describe('listening-speed processing', () => {
  it('Admit: refuses a transformed unit while the previous tempo worker is still retiring', async () => {
    const { service, synthesize, output } = tempoHarness(
      1.25,
      true,
      vi.fn(() => true),
    );
    await service.speak('Selected text.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Speech is still finishing; try again shortly.');
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('admits an unchanged-rate unit even while a tempo worker is retiring', async () => {
    const { service, synthesize, output } = tempoHarness(
      1,
      true,
      vi.fn(() => true),
    );
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(synthesize).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalled();
    });
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(decodeSpeechWav).mockReturnValue(new Int16Array([1, -1]));
    vi.mocked(encodeTempoWav).mockReturnValue({ wav: new Uint8Array(48), durationMs: 601 });
  });
  it('snapshots listening speed, transforms once, and uses transformed duration without a second cloud request', async () => {
    const { service, settings, synthesize, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    settings.listeningSpeed = 1.5;
    expect(transform.mock.calls[0]?.[0]).toMatchObject({ unitId: 1, part: 0, rate: 1.25 });
    expect(output.play).not.toHaveBeenCalled();
    pending.resolve(new Int16Array([1, -1, 1]));
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), 601);
    });
    expect(encodeTempoWav).toHaveBeenCalledWith(expect.any(Int16Array), true);
    expect(synthesize).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('keeps normal-speed provider WAV byte-identical and makes no transform or extra cloud request', async () => {
    const { service, wav, synthesize, transform, output } = tempoHarness(1);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledWith(1, wav, 1000);
    });
    expect(transform).not.toHaveBeenCalled();
    expect(decodeSpeechWav).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('ignores a canceled transform result and never plays it', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.cancel();
    await finished;
    pending.resolve(new Int16Array([1, -1]));
    await Promise.resolve();
    await Promise.resolve();
    expect(output.play).not.toHaveBeenCalled();
    expect(encodeTempoWav).not.toHaveBeenCalled();
  });

  it('fails closed when transformed audio exceeds the complete-unit duration limit', async () => {
    const { service, transform, output } = tempoHarness(0.75);
    transform.mockResolvedValueOnce(new Int16Array([1, -1]));
    vi.mocked(encodeTempoWav).mockReturnValueOnce({ wav: new Uint8Array(48), durationMs: 40_601 });
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('fails closed and releases the unit when the tempo worker rejects', async () => {
    const { service, transform, output } = tempoHarness(1.5);
    transform.mockRejectedValueOnce(new Error('worker failed'));
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
    service.dispose();
  });

  it('reports unavailable without starting playback when the tempo worker is absent', async () => {
    const { service, output } = tempoHarness(1.25, false);
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it.each(['provider waveform', 'worker waveform'] as const)('fails safely on malformed %s', async (which) => {
    const { service, transform, output } = tempoHarness(1.25);
    transform.mockResolvedValue(new Int16Array([1, -1]));
    if (which === 'provider waveform') {
      vi.mocked(decodeSpeechWav).mockImplementationOnce(() => {
        throw new Error('bad waveform');
      });
    } else {
      vi.mocked(encodeTempoWav).mockImplementationOnce(() => {
        throw new Error('bad worker result');
      });
    }
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('ignores rejection from a tempo request after cancellation', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.cancel();
    pending.reject(new Error('late failure'));
    await finished;
    await Promise.resolve();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('does not report a synchronous worker failure after reentrant cancellation', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    transform.mockImplementationOnce(() => {
      service.cancel();
      throw new Error('failed after cancellation');
    });
    await service.speak('Selected text.');
    expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('absorbs tempo disposal failure after stopping the service', async () => {
    const { service, dispose } = tempoHarness(1.25);
    dispose.mockRejectedValueOnce(new Error('worker already failed'));
    service.dispose();
    await Promise.resolve();
  });

  it('keeps a completed transform silent while paused and plays it on resume', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.pause();
    pending.resolve(new Int16Array([1, -1]));
    await vi.waitFor(() => {
      expect(encodeTempoWav).toHaveBeenCalledOnce();
    });
    expect(output.play).not.toHaveBeenCalled();
    service.resume();
    expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), 601);
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('does not start a third synthesis while the second part is still transforming', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    const second = Promise.withResolvers<Int16Array>();
    const transform = vi
      .fn()
      .mockResolvedValueOnce(new Int16Array([1, -1]))
      .mockReturnValueOnce(second.promise);
    const output: SpeechOutput = {
      parts: true,
      play: vi.fn(() => 7),
      control: vi.fn<SpeechOutput['control']>(),
      status: vi.fn<SpeechOutput['status']>(),
    };
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      createLocal: newLocal().factory,
      tempo: { transform, busy: () => false, dispose: vi.fn().mockResolvedValue(undefined) },
      settings: () => ({
        enabled: true,
        provider: 'kokoro',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: '',
        elevenLabsSpeed: 1,
        listeningSpeed: 1.25,
      }),
    });
    const finished = service.speak('First sentence. Second sentence. Third sentence.');
    await vi.waitFor(() => {
      expect(local.port.load).toHaveBeenCalled();
    });
    local.ready();
    await local.audio(1, 0);
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledTimes(1);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
    expect(local.calls).toHaveLength(2);
    await local.audio(1, 1);
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledTimes(2);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
    expect(local.calls).toHaveLength(2);
    expect(output.play).toHaveBeenCalledTimes(1);
    second.resolve(new Int16Array([1, -1]));
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledTimes(2);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
    expect(local.calls).toHaveLength(3);
    service.cancel();
    await finished;
    service.dispose();
  });
});

it('ExplicitNoFallback: refuses explicit GPU before starting a CPU worker', async () => {
  const { service, output, local: engine } = harness(true, () => 'gpu');
  await service.speak('Hello.');
  expect(engine.port.load).not.toHaveBeenCalled();
  expect(engine.port.synthesize).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(expect.any(Number), 'unavailable', 'GPU speech is not available. Check GPU setup.');
});

it('reports the CPU backend when its worker becomes ready and clears it on retirement', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const backend = vi.fn<(value: import('../src/speech_compute_types').SpeechComputeBackend) => void>();
  const engine = newLocal();
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    createLocal: engine.factory,
    actualBackend: backend,
    output: mock<SpeechOutput>(),
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const speech = service.speak('Hello.');
  await settle();
  engine.listener?.ready();
  expect(backend).toHaveBeenCalledWith('cpu');
  engine.listener?.retired('worker_exit');
  expect(backend).toHaveBeenLastCalledWith('none');
  await speech;
});
