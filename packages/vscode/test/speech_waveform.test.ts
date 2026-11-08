import { describe, expect, it } from 'vitest';
import { checkedTokenCount, encodeSpeechWav } from '../src/speech_waveform';

describe('checkedTokenCount', () => {
  it('rejects boundary-only and overlong input, and accepts every content token', () => {
    expect(() => checkedTokenCount(2)).toThrow('no speakable content');
    expect(checkedTokenCount(3)).toBe(1);
    expect(checkedTokenCount(512)).toBe(510);
    expect(() => checkedTokenCount(513)).toThrow('too long');
    expect(() => checkedTokenCount(3.5)).toThrow('no speakable content');
  });
});

describe('encodeSpeechWav', () => {
  it('encodes finite audio with 600 ms of trailing silence', () => {
    const result = encodeSpeechWav(new Float32Array([0.5, -0.5]), 24_000);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    expect(Buffer.from(result.subarray(0, 4)).toString()).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getInt16(44, true)).toBe(16_383);
    expect(view.getInt16(46, true)).toBe(-16_384);
    expect(result.length).toBe(44 + (2 + 14_400) * 2);
    expect(result.at(-1)).toBe(0);
  });

  it('refuses invalid, silent, or overlong generated waveforms', () => {
    expect(() => encodeSpeechWav(new Float32Array(), 24_000)).toThrow();
    expect(() => encodeSpeechWav(new Float32Array([0, 0]), 24_000)).toThrow();
    expect(() => encodeSpeechWav(new Float32Array([Number.NaN]), 24_000)).toThrow();
    expect(() => encodeSpeechWav(new Float32Array(960_001).fill(0.5), 24_000)).toThrow();
    expect(() => encodeSpeechWav(new Float32Array([1]), 0)).toThrow();
  });
});

it('adds the thinking tail only when explicitly requested for the final part', () => {
  const samples = new Float32Array([0.5, -0.5]);
  const part = encodeSpeechWav(samples, 24_000, false);
  const final = encodeSpeechWav(samples, 24_000, true);
  expect(part.length).toBe(44 + samples.length * 2);
  expect(final.length - part.length).toBe(24_000 * 0.6 * 2);
});
