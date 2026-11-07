import { expect, it, vi } from 'vitest';
import { encodeSpeechWav } from '../src/speech_waveform';
import { pcmToSpeech } from '../src/speech_pcm';

vi.mock('../src/speech_waveform', () => ({ encodeSpeechWav: vi.fn(() => new Uint8Array(48)) }));

it('converts complete signed little-endian PCM and retains the thinking interval', () => {
  const result = pcmToSpeech(new Uint8Array([0, 128, 255, 127]));
  expect(encodeSpeechWav).toHaveBeenCalledOnce();
  const call = vi.mocked(encodeSpeechWav).mock.calls[0];
  if (call === undefined) throw new Error('missing call');
  const [samples, rate] = call;
  expect([...samples]).toEqual([-1, 32_767 / 32_768]);
  expect(rate).toBe(24_000);
  expect(Array.from(result.wav.slice(44))).toEqual([0, 128, 255, 127]);
  expect(result.durationMs).toBe(600 + (2 / 24_000) * 1000);
});

it('rejects empty, odd-length and overlong PCM without truncation', () => {
  for (const pcm of [new Uint8Array(), new Uint8Array([1]), new Uint8Array(1_920_002)]) {
    expect(() => pcmToSpeech(pcm)).toThrow();
  }
});
