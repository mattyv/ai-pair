import { describe, expect, it } from 'vitest';
import { localSpeechDiagnostics } from '../src/local_diagnostics';

describe('local speech diagnostics', () => {
  it('accepts only bounded, fixed lifecycle metadata', () => {
    expect(
      localSpeechDiagnostics.safeParse([{ kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1 }]).success,
    ).toBe(true);
    expect(
      localSpeechDiagnostics.safeParse([
        { kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1, text: 'private' },
      ]).success,
    ).toBe(false);
    expect(
      localSpeechDiagnostics.safeParse(
        Array.from({ length: 101 }, () => ({ kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro', seq: 1, time: 1 })),
      ).success,
    ).toBe(false);
  });
});
