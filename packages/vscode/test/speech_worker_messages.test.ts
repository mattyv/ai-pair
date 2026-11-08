import { describe, expect, it } from 'vitest';
import { SPEECH_WORKER_INPUT, SPEECH_WORKER_OUTPUT } from '../src/speech_worker_messages';

describe('speech worker messages', () => {
  it('accepts only the supported bounded request forms', () => {
    expect(SPEECH_WORKER_INPUT.safeParse({ type: 'load', modelPath: '/model' }).success).toBe(true);
    expect(SPEECH_WORKER_INPUT.safeParse({ type: 'synthesize', id: 1, text: 'Hello.', voice: 'af_heart', speed: 1 }).success).toBe(true);
    for (const value of [
      { type: 'load', modelPath: '' },
      { type: 'synthesize', id: 1, text: '{}', voice: 'other', speed: 1 },
      { type: 'synthesize', id: 1, text: 'x', voice: 'af_heart', speed: 4 },
      { type: 'synthesize', id: 0, text: 'x', voice: 'af_heart', speed: 1 },
    ]) {
      expect(SPEECH_WORKER_INPUT.safeParse(value).success).toBe(false);
    }
  });

  it('validates replies before the service consumes them', () => {
    expect(SPEECH_WORKER_OUTPUT.safeParse({ type: 'ready' }).success).toBe(true);
    expect(SPEECH_WORKER_OUTPUT.safeParse({ type: 'audio', id: 1, wav: new Uint8Array([1]), durationMs: 1 }).success).toBe(true);
    expect(SPEECH_WORKER_OUTPUT.safeParse({ type: 'error', id: 1, message: 'Unavailable' }).success).toBe(true);
    expect(SPEECH_WORKER_OUTPUT.safeParse({ type: 'audio', id: 1, wav: 'bytes', durationMs: 1 }).success).toBe(false);
  });
});

it('requires a bounded ordinal and final flag together for multipart requests', () => {
  const request = { type: 'synthesize', id: 1, text: 'Text.', voice: 'af_heart', speed: 1 };
  expect(SPEECH_WORKER_INPUT.safeParse({ ...request, part: 0 }).success).toBe(false);
  expect(SPEECH_WORKER_INPUT.safeParse({ ...request, final: false }).success).toBe(false);
  expect(SPEECH_WORKER_INPUT.safeParse({ ...request, part: 4, final: false }).success).toBe(false);
  expect(SPEECH_WORKER_INPUT.safeParse({ ...request, part: 1, final: false }).success).toBe(true);
});
