import { describe, expect, it } from 'vitest';
import { decodeSpeechWav, encodeTempoWav } from '../src/speech_tempo_pcm';

describe('tempo PCM framing', () => {
  it('round trips exact signed samples and appends one final silent tail', () => {
    const input = Int16Array.from([-32_768, -1, 0, 1, 32_767]);
    const part = encodeTempoWav(input, false);
    const final = encodeTempoWav(input, true);
    expect(part.wav.length).toBe(44 + input.length * 2);
    expect(final.wav.length - part.wav.length).toBe(28_800);
    expect(final.durationMs - part.durationMs).toBeCloseTo(600);
    expect(decodeSpeechWav(part.wav, false)).toEqual(input);
    expect(decodeSpeechWav(final.wav, true)).toEqual(input);
  });

  it('rejects malformed headers, size fields and missing or nonzero final tails', () => {
    const wav = encodeTempoWav(Int16Array.from([1, -1]), true).wav;
    const invalidMagic = wav.slice();
    invalidMagic[0] = 0;
    const invalidRate = wav.slice();
    new DataView(invalidRate.buffer).setUint32(24, 16_000, true);
    const invalidSize = wav.slice();
    new DataView(invalidSize.buffer).setUint32(40, 2, true);
    const nonzeroTail = wav.slice();
    nonzeroTail[nonzeroTail.length - 1] = 1;
    for (const value of [new Uint8Array(43), invalidMagic, invalidRate, invalidSize, nonzeroTail]) {
      expect(() => decodeSpeechWav(value, true)).toThrow();
    }
    expect(() => decodeSpeechWav(encodeTempoWav(Int16Array.from([1]), false).wav, true)).toThrow();
  });

  it('rejects empty and excessive audio', () => {
    expect(() => encodeTempoWav(new Int16Array(), false)).toThrow();
    expect(() => encodeTempoWav(new Int16Array(960_001), false)).toThrow();
  });
});
