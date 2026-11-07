import { expect, it } from 'vitest';
import { pcmToSpeech } from '../src/speech_pcm';

it('preserves signed PCM endpoints and single-count samples in the WAV output', () => {
  const input = new Uint8Array([0, 128, 255, 255, 0, 0, 1, 0, 255, 127]);
  const { wav } = pcmToSpeech(input);
  expect(Array.from(wav.slice(44, 54))).toEqual(Array.from(input));
});
