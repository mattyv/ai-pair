import { afterEach, expect, it, vi } from 'vitest';
import { NativeAdapter } from '../../audio-native/src/native_adapter';
import type { AudioEvent } from '../../audio-native/src';
import { SpeechService } from '../../vscode/src/speech_service';
import { CompanionOutput } from '../src/companion_output';

const fake = vi.hoisted(() => {
  class Worker {
    static current?: Worker;
    listeners = new Map<string, (value: unknown) => void>();
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(0);
    constructor() {
      Worker.current = this;
    }
    on(event: string, callback: (value: unknown) => void) {
      this.listeners.set(event, callback);
      return this;
    }
    emit(value: unknown) {
      this.listeners.get('message')?.(value);
    }
  }
  return { Worker };
});
vi.mock('node:worker_threads', () => ({ Worker: fake.Worker }));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn().mockResolvedValue(true) }));
vi.mock('../../vscode/src/speech_setup', () => ({ installedSpeechModel: vi.fn().mockResolvedValue('/synthetic') }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const arch = Object.getOwnPropertyDescriptor(process, 'arch');
afterEach(() => {
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
  fake.Worker.current = undefined;
});

it('SentencePipeline composes one captured route through physical closes and completes only the final part', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  let defaultId = 'speaker-a';
  const signals: Array<(event: AudioEvent['type']) => void> = [];
  const closes: Array<ReturnType<typeof Promise.withResolvers<void>>> = [];
  const backend = {
    defaultId: () => Promise.resolve(defaultId),
    list: () =>
      Promise.resolve([
        { id: 'speaker-a', label: 'A' },
        { id: 'speaker-b', label: 'B' },
      ]),
    start: vi.fn((route: string, wav: Uint8Array, signal: (event: AudioEvent['type']) => void) => {
      expect(route).toBe('speaker-a');
      expect(wav.length).toBe(44);
      signals.push(signal);
      const closed = Promise.withResolvers<void>();
      closes.push(closed);
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    }),
  };
  const adapter = new NativeAdapter(backend);
  let service: SpeechService;
  const output = new CompanionOutput({
    adapter,
    connectionEpoch: 'epoch',
    page: () => 7,
    choice: () => ({ kind: 'default' }),
    ready: () => true,
    event: (event) => {
      service.audioEvent(event);
    },
    status: vi.fn<SpeechServiceOutputStatus>(),
  });
  service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const gate = service.speak('First sentence. Second sentence.');
  let settled = false;
  void gate.then(() => {
    settled = true;
  });
  await vi.waitFor(() => {
    expect(fake.Worker.current).toBeDefined();
  });
  const worker = fake.Worker.current;
  if (worker === undefined) throw new Error('No worker');
  worker.emit({ type: 'ready' });
  worker.emit({ type: 'audio', id: 1, part: 0, wav: new Uint8Array(44), durationMs: 1000 });
  await vi.waitFor(() => {
    expect(backend.start).toHaveBeenCalledTimes(1);
  });
  signals[0]?.('started');
  await vi.waitFor(() => {
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
  });
  worker.emit({ type: 'audio', id: 1, part: 1, wav: new Uint8Array(44), durationMs: 1000 });
  signals[0]?.('ended');
  await Promise.resolve();
  expect(backend.start).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  defaultId = 'speaker-b';
  closes[0]?.resolve();
  await vi.waitFor(() => {
    expect(backend.start).toHaveBeenCalledTimes(2);
  });
  signals[1]?.('started');
  signals[1]?.('ended');
  await Promise.resolve();
  expect(settled).toBe(false);
  closes[1]?.resolve();
  await gate;
  expect(settled).toBe(true);
  await output.stopAndWait();
  output.dispose();
  service.dispose();
});

type SpeechServiceOutputStatus = import('../../vscode/src/speech_service').SpeechOutput['status'];
