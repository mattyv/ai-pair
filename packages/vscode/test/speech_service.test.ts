import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { ElevenLabsSpeechPort } from '../src/speech_types';

const fake = vi.hoisted(() => {
  class Worker {
    static made: Worker[] = [];
    static failPost = false;
    listeners = new Map<string, (...args: unknown[]) => void>();
    postMessage = vi.fn(() => {
      if (Worker.failPost) throw new Error('worker closed');
    });
    terminate = vi.fn(() => Promise.resolve(0));
    on = vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      this.listeners.set(event, callback);
      return this;
    });
    constructor(
      readonly filename: string,
      readonly options?: unknown,
    ) {
      Worker.made.push(this);
    }
    emit(event: string, value?: unknown): void {
      this.listeners.get(event)?.(value);
    }
  }
  return { Worker };
});
vi.mock('node:worker_threads', () => ({ Worker: fake.Worker }));
vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

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

/** Makes a service with a live page and local preferences. */
function harness(enabled = true) {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.play.mockReturnValue(7);
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  return { service, output };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.Worker.made.length = 0;
  fake.Worker.failPost = false;
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
      expect(fake.Worker.made).toHaveLength(1);
      service.cancel();
      await gate;
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'platform', original);
    }
  });

  it('defaults to silent behavior when disabled', async () => {
    const { service, output } = harness(false);
    await service.speak('Hello.');
    expect(fake.Worker.made).toHaveLength(0);
    expect(output.play).not.toHaveBeenCalled();
  });

  it('matches generation and page acknowledgements before resolving speech', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    expect(worker.filename).toBe('/runtime/worker.mjs');
    expect(worker.options).toEqual({ workerData: { modelPath: '/model' } });
    worker.emit('message', { type: 'ready' });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'synthesize', id: 1, text: 'Hello.', voice: 'af_heart', speed: 1 });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    service.pause();
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    expect(output.play).not.toHaveBeenCalled();
    service.cancel();
    await gate;
    service.resume();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('times out a stuck worker and ignores its late output', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    await vi.advanceTimersByTimeAsync(20_000);
    await gate;
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    expect(fake.Worker.made).toHaveLength(0);
  });

  it('does not post audio when its preparing notification synchronously cancels it', async () => {
    const { service, output } = harness();
    let preparations = 0;
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'preparing' && ++preparations === 2) service.cancel();
    });
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    await gate;
    expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
  });

  it('does not retry synthesis while a canceled worker job is still running', async () => {
    const { service, output } = harness();
    const first = service.speak('First.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    service.cancel();
    await first;
    await service.speak('Second.');
    expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    const third = service.speak('Third.');
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, text: 'Third.' }));
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    expect(output.play).not.toHaveBeenCalled();
    service.cancel();
    await third;
  });

  it('times out an active model load and falls back to reading', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    await vi.advanceTimersByTimeAsync(20_000);
    await gate;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('bounds a canceled model load without waiting for another request', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    service.cancel();
    await gate;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not let a duplicate ready message clear the synthesis watchdog', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'ready' });
    service.cancel();
    await gate;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('ignores a stale worker watchdog after a later synthesis starts', async () => {
    const { service } = harness();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const first = service.speak('First.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    const callback: unknown = timers.mock.calls.at(-1)?.[0];
    service.cancel();
    await first;
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    const next = service.speak('Next.');
    if (!isTimerCallback(callback)) throw new Error('No worker timeout');
    callback();
    expect(worker.terminate).not.toHaveBeenCalled();
    service.cancel();
    await next;
    timers.mockRestore();
  });

  it('times out a canceled synthesis and waits for termination before retrying', async () => {
    const { service, output } = harness();
    const first = service.speak('First.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    const termination = Promise.withResolvers<number>();
    worker.terminate.mockReturnValueOnce(termination.promise);
    worker.emit('message', { type: 'ready' });
    service.cancel();
    await first;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await service.speak('Second.');
    expect(fake.Worker.made).toHaveLength(1);
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    expect(output.play).not.toHaveBeenCalled();
    termination.resolve(0);
    await settle();
    const third = service.speak('Third.');
    await settle();
    expect(fake.Worker.made).toHaveLength(2);
    service.cancel();
    await third;
  });

  it('waits for worker termination before starting another CPU job', async () => {
    const { service, output } = harness();
    const first = service.speak('First.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    const termination = Promise.withResolvers<number>();
    worker.terminate.mockReturnValueOnce(termination.promise);
    worker.emit('message', { type: 'ready' });
    await vi.advanceTimersByTimeAsync(20_000);
    await first;
    await service.speak('Second.');
    expect(fake.Worker.made).toHaveLength(1);
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    expect(output.play).not.toHaveBeenCalled();
    termination.resolve(0);
    await settle();
    const third = service.speak('Third.');
    await settle();
    expect(fake.Worker.made).toHaveLength(2);
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    await gate;
    expect(noPage.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('panel'));
    const invalid = noPage.service.speak('Again.');
    worker.emit('message', { type: 'audio', id: 2, wav: new Uint8Array(43), durationMs: 1000 });
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
      const service = new SpeechService({
        runtimeDirectory: '/runtime',
        storageDirectory: '/storage',
        localDesktop: true,
        output,
        settings: () => settings,
      });
      await service.speak('Hello.');
      expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('supported'));
      expect(fake.Worker.made).toHaveLength(0);
    }
  });

  it('reports a package without a bundled runtime as unavailable', async () => {
    const { service, output } = harness();
    vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(false);
    const gate = service.speak('Hello.');
    await settle();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('runtime'));
    expect(fake.Worker.made).toHaveLength(0);
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
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(fake.Worker.made).toHaveLength(0);
  });

  it('explains unsupported extension hosts without starting a worker', async () => {
    const output = mock<SpeechOutput>();
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: false,
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(fake.Worker.made).toHaveLength(0);
  });

  it('resumes a prepared waveform only when the global pause clears', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    service.pause();
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    service.pause();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(output.status).toHaveBeenLastCalledWith(1, 'paused');
    service.resume();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it.each(['error', 'exit'])('falls back when a worker emits %s', async (event) => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit(event);
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
  });

  it('keeps a loading worker after cancellation but ignores the old request', async () => {
    const { service } = harness();
    const first = service.speak('Old.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    service.cancel();
    await first;
    const next = service.speak('New.');
    await settle();
    worker.emit('message', { type: 'ready' });
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, text: 'New.' }));
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

  it('handles failure to send a synthesis request', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    fake.Worker.failPost = true;
    worker.emit('message', { type: 'ready' });
    await gate;
    expect(worker.terminate).toHaveBeenCalledOnce();
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
    const { service } = harness();
    const first = service.speak('Old.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    service.cancel();
    await first;
    worker.emit('message', { type: 'ready' });
    const next = service.speak('New.');
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, text: 'New.' }));
    worker.emit('message', { type: 'error', id: 1, message: 'Old failure.' });
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
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    await gate;
    expect(output.control).not.toHaveBeenCalled();
    service.dispose();
    service.dispose();
  });

  it('keeps the watchdog remaining time after a duplicate pause', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
    expect(fake.Worker.made).toHaveLength(0);
    const next = harness();
    vi.mocked(installedSpeechModel).mockRejectedValueOnce(new Error('private path'));
    await next.service.speak('New.');
    expect(next.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('could not start'));
    expect(JSON.stringify(next.output.status.mock.calls)).not.toContain('private path');
  });

  it('handles a worker load error without an ID and ignores an old worker exit', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'error', message: 'Load failed.' });
    await gate;
    worker.emit('exit');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('resumes an audio element that has not acknowledged starting yet', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    service.pageClosed(8);
    service.pause();
    service.resume();
    expect(output.status).toHaveBeenLastCalledWith(1, 'preparing');
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it('cleans up a worker when posting its load request throws', async () => {
    const { service, output } = harness();
    fake.Worker.failPost = true;
    await service.speak('Hello.');
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('falls back on worker errors, invalid messages, and audio play failures', async () => {
    const first = harness();
    const gate = first.service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'not-a-worker-reply' });
    await gate;
    expect(first.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(worker.terminate).toHaveBeenCalledOnce();

    const second = harness();
    second.output.play.mockImplementation(() => {
      throw new Error('closed page');
    });
    const next = second.service.speak('Hello.');
    await settle();
    const nextWorker = fake.Worker.made[1];
    if (nextWorker === undefined) throw new Error('No worker');
    nextWorker.emit('message', { type: 'ready' });
    nextWorker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
    await next;
    expect(second.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('Audio'));
  });

  it('surfaces worker and page errors without releasing another generation', async () => {
    const { service, output } = harness();
    const first = service.speak('One.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'error', id: 1, message: 'No speakable content.' });
    await first;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'No speakable content.');
    const next = service.speak('Two.');
    worker.emit('message', { type: 'audio', id: 2, wav: new Uint8Array(44), durationMs: 1000 });
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'failed' })).toBeUndefined();
    expect(service.audioEvent({ id: 2, pageId: 7, event: 'failed' })).toBe('failed');
    await next;
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('Preview'));
  });

  it('allows preview while disabled and gives live speech priority over preview', async () => {
    const disabled = harness(false);
    const preview = disabled.service.preview();
    await settle();
    expect(fake.Worker.made).toHaveLength(1);
    disabled.service.cancel();
    await preview;

    const live = harness();
    const sample = live.service.preview();
    await settle();
    const worker = fake.Worker.made[1];
    if (worker === undefined) throw new Error('No worker');
    worker.emit('message', { type: 'ready' });
    const next = live.service.speak('Live.');
    await sample;
    await next;
    expect(live.output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
  });

  it('absorbs an error while terminating a failed worker', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    worker.terminate.mockRejectedValueOnce(new Error('already stopped'));
    service.dispose();
    await gate;
    await settle();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('disposes a worker and refuses new requests', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    const worker = fake.Worker.made[0];
    if (worker === undefined) throw new Error('No worker');
    service.dispose();
    await gate;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await service.speak('Later.');
    expect(fake.Worker.made).toHaveLength(1);
  });
});

describe('cloud narration', () => {
  it('sends the selected text once, and accepts only the current page ending', async () => {
    const cloud = mock<ElevenLabsSpeechPort>();
    cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
    const output = mock<SpeechOutput>();
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
  output.play.mockReturnValue(7);
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
    settings: () => settings,
  });
  return { cloud, output, service, settings };
}

it('supports cloud on macOS without requiring the local runtime', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const { cloud, service } = cloudHarness();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Hello.');
  await settle();
  expect(fake.Worker.made).toHaveLength(0);
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
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  await vi.advanceTimersByTimeAsync(20_000);
  await gate;
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('timed out'));
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
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
  expect(fake.Worker.made).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('provider'));
});

it('never sends cloud speech from a remote extension host', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
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
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'ready' });
  worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('does not report a late rejected cloud request after cancellation', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  pending.reject(new Error('late'));
  await settle();
  expect(output.status).not.toHaveBeenCalled();
});

it('expires a canceled request that ignores abort, without another status update', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(output.status).not.toHaveBeenCalled();
});

it('does not let an idle local worker failure interrupt an active cloud unit', async () => {
  const output = mock<SpeechOutput>();
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
    settings: () => settings,
  });
  const localGate = service.speak('Local.');
  await settle();
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'ready' });
  worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await localGate;
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  worker.emit('error', new Error('old local worker stopped'));
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('resolves the speech gate if cloud service disappears during the preparing callback', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
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
    settings: () => settings,
  });
  await service.speak('Local.');
  expect(fake.Worker.made).toHaveLength(0);
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('uses local defaults for a preference saved before providers existed', async () => {
  const output = mock<SpeechOutput>();
  const settings = { enabled: true, provider: 'kokoro' as const, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
  Reflect.deleteProperty(settings, 'provider');
  const service = new SpeechService({ runtimeDirectory: '', storageDirectory: '', localDesktop: true, output, settings: () => settings });
  const gate = service.speak('Local.');
  await settle();
  expect(fake.Worker.made).toHaveLength(1);
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
  const gate = service.speak('Synthetic.');
  await settle();
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('error', { code: 'ERR_DLOPEN_FAILED', message: '/private/lib secret text' });
  await gate;
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_native');
  expect(JSON.stringify(vi.mocked(output.localDiagnostic)?.mock.calls)).not.toMatch(/private|secret/);
});

it('records a local worker-ready checkpoint before synthesis', async () => {
  const { service, output } = harness();
  const gate = service.speak('Synthetic.');
  await settle();
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'ready' });
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
  const gate = service.speak('Synthetic.');
  await settle();
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('error', error);
  await gate;
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', reason);
  expect(JSON.stringify(vi.mocked(output.localDiagnostic)?.mock.calls)).not.toMatch(/private|SOME_UNKNOWN/);
});

it('classifies model-load failure separately from an error after readiness', async () => {
  const first = harness();
  const firstGate = first.service.speak('Synthetic.');
  await settle();
  const firstWorker = fake.Worker.made.at(-1);
  if (firstWorker === undefined) throw new Error('No worker');
  firstWorker.emit('message', { type: 'error', message: 'Could not load local speech. Retry setup.' });
  await firstGate;
  expect(first.output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
  const second = harness();
  const secondGate = second.service.speak('Synthetic.');
  await settle();
  const secondWorker = fake.Worker.made.at(-1);
  if (secondWorker === undefined) throw new Error('No worker');
  secondWorker.emit('message', { type: 'ready' });
  secondWorker.emit('message', { type: 'error', message: 'Invalid request.' });
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
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'ready' });
  worker.emit('message', { type: 'audio', id: 1, wav: new Uint8Array(44), durationMs: 1000 });
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
