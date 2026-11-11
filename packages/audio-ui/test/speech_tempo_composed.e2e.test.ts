import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeAdapter } from '../../audio-native/src/native_adapter';
import type { AudioEvent } from '../../audio-native/src';
import { LOCAL_CAPABILITIES } from '../../vscode/src/speech_local_protocol';
import { SpeechService, type SpeechOutput } from '../../vscode/src/speech_service';
import { SpeechTempoClient } from '../../vscode/src/speech_tempo_client';
import { encodeTempoWav } from '../../vscode/src/speech_tempo_pcm';
import { CompanionOutput } from '../src/companion_output';

const fake = vi.hoisted(() => {
  class Worker {
    static current?: Worker;
    listeners = new Map<string, (value: unknown) => void>();
    postMessage = vi.fn();
    terminate = vi.fn(() =>
      Promise.resolve().then(() => {
        this.listeners.get('exit')?.(0);
        return 0;
      }),
    );
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
vi.mock('node:worker_threads', async (original) => {
  const real = await original<typeof import('node:worker_threads')>();
  return {
    ...real,
    Worker: function (filename: string) {
      return filename === '/runtime/worker.mjs' ? new fake.Worker() : new real.Worker(filename);
    },
  };
});
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn().mockResolvedValue(true) }));
vi.mock('../../vscode/src/speech_setup', () => ({ installedSpeechModel: vi.fn().mockResolvedValue('/synthetic') }));

/** Builds the ready reply of epoch 1 with the capabilities as plain arrays, as the schema requires. */
function ready() {
  return {
    type: 'ready',
    version: 1,
    epoch: 1,
    capabilities: { ...LOCAL_CAPABILITIES, voices: [...LOCAL_CAPABILITIES.voices], speeds: [...LOCAL_CAPABILITIES.speeds] },
  };
}

let directory: string | undefined;
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const arch = Object.getOwnPropertyDescriptor(process, 'arch');
afterEach(async () => {
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
  fake.Worker.current = undefined;
  if (directory !== undefined) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('transforms two synthetic Kokoro parts in a real worker before local physical playback', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-tempo-composed-'));
  const workerPath = path.join(directory, 'tempo_worker.mjs');
  await esbuild.build({
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    entryPoints: [path.join(import.meta.dirname, '../../vscode/src/speech_tempo_worker.ts')],
    outfile: workerPath,
  });
  // esbuild picks its native binary by platform, so the host is spoofed only after the build.
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const tempo = new SpeechTempoClient(workerPath);
  const signals: Array<(event: AudioEvent['type']) => void> = [];
  const closes: Array<ReturnType<typeof Promise.withResolvers<void>>> = [];
  const backend = {
    list: () => Promise.resolve([{ id: 'speaker', label: 'Speaker' }]),
    start: vi.fn((route: string, wav: Uint8Array, signal: (event: AudioEvent['type']) => void) => {
      expect(route).toBe('speaker');
      expect(wav.length).toBeGreaterThan(44);
      signals.push(signal);
      const closed = Promise.withResolvers<void>();
      closes.push(closed);
      return {
        closed: closed.promise,
        stop: () => {
          closed.resolve();
        },
      };
    }),
  };
  const adapter = new NativeAdapter(backend);
  let service: SpeechService;
  const output = new CompanionOutput({
    adapter,
    connectionEpoch: 'epoch',
    page: () => 7,
    choice: () => ({ kind: 'device', id: 'speaker' }),
    ready: () => true,
    event: (event) => {
      service.audioEvent(event);
    },
    status: vi.fn<SpeechOutput['status']>(),
  });
  service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    tempo,
    settings: () => ({
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1.5,
    }),
  });
  const pcm = Int16Array.from({ length: 4800 }, (_, index) => Math.round(8000 * Math.sin(index / 20)));
  try {
    const gate = service.speak('First sentence. Second sentence.');
    await vi.waitFor(() => {
      expect(fake.Worker.current).toBeDefined();
    });
    const worker = fake.Worker.current;
    if (worker === undefined) throw new Error('No worker');
    worker.emit(ready());
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledTimes(2);
    });
    const first = encodeTempoWav(pcm, false);
    worker.emit({ type: 'result', version: 1, epoch: 1, id: 1, part: 0, wav: first.wav, durationMs: first.durationMs });
    await vi.waitFor(() => {
      expect(backend.start).toHaveBeenCalledTimes(1);
    });
    expect(backend.start.mock.calls[0]?.[1].length).toBe(44 + 3200 * 2);
    signals[0]?.('started');
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalledTimes(3);
    });
    const second = encodeTempoWav(pcm, true);
    worker.emit({ type: 'result', version: 1, epoch: 1, id: 1, part: 1, wav: second.wav, durationMs: second.durationMs });
    signals[0]?.('ended');
    closes[0]?.resolve();
    await vi.waitFor(() => {
      expect(backend.start).toHaveBeenCalledTimes(2);
    });
    expect(backend.start.mock.calls[1]?.[1].length).toBe(44 + (3200 + 14_400) * 2);
    signals[1]?.('started');
    signals[1]?.('ended');
    closes[1]?.resolve();
    await gate;
  } finally {
    await service.dispose();
    output.dispose();
    await tempo.dispose();
  }
});
