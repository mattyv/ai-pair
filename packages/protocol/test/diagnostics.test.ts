import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_SNAPSHOT_SCHEMA } from '../src/diagnostics';

const snapshot = {
  version: '1.0.0',
  build: 'abc',
  session: 'active',
  connection: 'connected',
  connectionId: 1,
  paused: false,
  pauseReasons: [],
  events: [],
};

describe('diagnostic snapshot', () => {
  it('accepts bounded allowlisted workspace and audio facts', () => {
    expect(
      DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({
        ...snapshot,
        localSpeech: 'unavailable',
        audio: {
          enabled: true,
          provider: 'kokoro',
          keyConfigured: false,
          voiceConfigured: true,
          output: 'default',
          routeAvailable: 'unknown',
          runtimeReady: true,
          modelReady: 'unknown',
          lastPlayback: 'unknown',
        },
      }).success,
    ).toBe(true);
  });
  it('rejects secrets, arbitrary fields, and excess events', () => {
    expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({ ...snapshot, session: 'idle' }).success).toBe(true);
    expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({ ...snapshot, key: 'secret' }).success).toBe(false);
    expect(
      DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({
        ...snapshot,
        events: Array.from({ length: 101 }, () => ({ kind: 'session', state: 'active', seq: 1, time: 1 })),
      }).success,
    ).toBe(false);
    expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({ ...snapshot, audio: { enabled: true, voice: 'private' } }).success).toBe(false);
  });
});

it('accepts OpenRouter readiness without allowing credentials', () => {
  const audio = {
    enabled: true,
    provider: 'openrouter',
    keyConfigured: true,
    voiceConfigured: true,
    output: 'default',
    routeAvailable: 'unknown',
    runtimeReady: 'unknown',
    modelReady: 'unknown',
    lastPlayback: 'unknown',
  };
  expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({ ...snapshot, audio }).success).toBe(true);
  expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse({ ...snapshot, audio: { ...audio, key: 'private' } }).success).toBe(false);
});
