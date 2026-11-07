import { encodeSpeechWav } from './speech_waveform';
import type { SpeechAudioResult } from './speech_types';

const SAMPLE_RATE = 24_000;
const MAX_BYTES = 1_920_000;
const BYTES_PER_SAMPLE = 2;
const SAMPLE_SCALE = 32_768;
const TRAILING_MS = 600;
const MS_PER_SECOND = 1000;
const WAV_HEADER_BYTES = 44;

/** Converts bounded signed PCM16LE to the existing WAV playback contract. */
export function pcmToSpeech(pcm: Uint8Array): SpeechAudioResult {
  if (pcm.length === 0 || pcm.length > MAX_BYTES || pcm.length % BYTES_PER_SAMPLE !== 0) {
    throw new Error('The generated audio has an invalid size.');
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(pcm.length / BYTES_PER_SAMPLE);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * BYTES_PER_SAMPLE, true) / SAMPLE_SCALE;
  const wav = encodeSpeechWav(samples, SAMPLE_RATE);
  // Keep the provider's exact 16-bit samples after the shared validation and
  // WAV framing; float quantization would otherwise lose a positive count.
  wav.set(pcm, WAV_HEADER_BYTES);
  return { wav, durationMs: (samples.length / SAMPLE_RATE) * MS_PER_SECOND + TRAILING_MS };
}
