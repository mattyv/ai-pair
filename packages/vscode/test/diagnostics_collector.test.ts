import { describe, expect, it, vi } from 'vitest';
import { collectDiagnostics } from '../src/diagnostics_collector';

const snapshot = {
  version: 'test',
  build: 'test',
  session: 'unavailable' as const,
  connection: 'unavailable' as const,
  connectionId: 'unavailable' as const,
  paused: 'unavailable' as const,
  pauseReasons: 'unavailable' as const,
  events: [],
};

describe('DiagnosticsRequest collection', () => {
  it('retains workspace facts when companion commands fail or return private data', async () => {
    const command = vi.fn((name: string): Promise<unknown> =>
      name === 'speech' ? Promise.reject(new Error('secret')) : Promise.resolve({ path: '/private' }),
    );
    expect(await collectDiagnostics({ snapshot: () => snapshot, companion: true, command, timeoutMs: 5 })).toEqual({
      ...snapshot,
      localSpeech: 'unavailable',
    });
  });
  it('returns within the bound when a companion hangs', async () => {
    const result = await collectDiagnostics({
      snapshot: () => snapshot,
      companion: true,
      command: () => new Promise(() => {}),
      timeoutMs: 5,
    });
    expect(result).toEqual({ ...snapshot, localSpeech: 'unavailable' });
  });
});

it('collects only validated companion speech, GPU, and audio observations', async () => {
  const speech = { version: 'test', build: 'test', events: [] };
  const gpu = { requestedMode: 'auto', actualBackend: 'cpu', check: { phase: 'idle' }, stage: 'idle' };
  const audio = {
    enabled: true,
    provider: 'kokoro',
    keyConfigured: false,
    voiceConfigured: true,
    output: 'default',
    routeAvailable: 'unknown',
    runtimeReady: true,
    modelReady: 'unknown',
    lastPlayback: 'unknown',
  };
  const command = vi.fn((name: string) => Promise.resolve(name === 'speech' ? speech : name === 'gpu' ? gpu : audio));
  expect(await collectDiagnostics({ snapshot: () => snapshot, companion: true, command, timeoutMs: 100 })).toEqual({
    ...snapshot,
    localSpeech: speech,
    gpu,
    audio,
  });
});

it('collects legacy audio without calling the companion', async () => {
  const audio = {
    enabled: false,
    provider: 'elevenlabs' as const,
    keyConfigured: true,
    voiceConfigured: false,
    output: 'override' as const,
    routeAvailable: false,
    runtimeReady: false,
    modelReady: 'unknown' as const,
    lastPlayback: 'failed' as const,
  };
  const command = vi.fn();
  expect(
    await collectDiagnostics({ snapshot: () => snapshot, companion: false, command, timeoutMs: 100, audio: () => Promise.resolve(audio) }),
  ).toEqual({ ...snapshot, audio });
  expect(command).not.toHaveBeenCalled();
  expect(await collectDiagnostics({ snapshot: () => snapshot, companion: false, command, timeoutMs: 100 })).toEqual(snapshot);
});
