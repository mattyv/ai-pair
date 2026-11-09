import { describe, expect, it } from 'vitest';
import { localSpeechDiagnostics } from '../src/local_diagnostics';

describe('local speech diagnostics', () => {
  it('accepts only bounded, fixed lifecycle metadata', () => {
    for (const reason of ['host_platform', 'host_arch', 'libc_unknown', 'libc_report_failed']) {
      expect(
        localSpeechDiagnostics.safeParse([
          { kind: 'speech', event: 'capability', phase: 'blocked', provider: 'kokoro', reason, seq: 1, time: 1 },
        ]).success,
      ).toBe(true);
    }
    expect(
      localSpeechDiagnostics.safeParse([{ kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1 }]).success,
    ).toBe(true);
    expect(
      localSpeechDiagnostics.safeParse([
        { kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1, text: 'private' },
      ]).success,
    ).toBe(true);
    expect(
      localSpeechDiagnostics.safeParse(
        Array.from({ length: 101 }, () => ({ kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1 })),
      ).success,
    ).toBe(false);
  });
});

it('accepts narration failures and strips private extra fields', () => {
  const event = {
    kind: 'speech',
    event: 'narration',
    phase: 'failed',
    provider: 'elevenlabs',
    reason: 'auth',
    seq: 1,
    time: 1,
    text: 'private',
  };
  expect(localSpeechDiagnostics.parse([event])).toEqual([
    { kind: 'speech', event: 'narration', phase: 'failed', provider: 'elevenlabs', reason: 'auth', seq: 1, time: 1 },
  ]);
});
