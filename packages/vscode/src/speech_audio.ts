/** The Kokoro model accepts 510 content tokens between two boundary tokens. */
const MAX_CONTENT_TOKENS = 510;
/** Kokoro's tokenizer adds a start and an end token. */
const BOUNDARY_TOKENS = 2;
/** Kokoro produces mono audio at this sample rate. */
const SAMPLE_RATE = 24000;
/** The largest waveform accepted before the thinking interval. */
const MAX_AUDIO_SECONDS = 40;
/** The thinking interval appended to a successful waveform. */
const TRAILING_SILENCE_SECONDS = 0.6;
/** A PCM WAV header contains 44 bytes. */
const WAV_HEADER_BYTES = 44;
/** A 16-bit signed PCM sample uses two bytes. */
const PCM_BYTES = 2;
/** The positive peak of a signed 16-bit sample. */
const PCM_POSITIVE_PEAK = 32767;
/** The absolute negative peak of a signed 16-bit sample. */
const PCM_NEGATIVE_PEAK = 32768;

/** Checks the complete, untruncated sequence before inference. */
export function checkedTokenCount(total: number): number {
  const content = total - BOUNDARY_TOKENS;
  if (!Number.isInteger(total) || content <= 0) throw new Error('The text has no speakable content.');
  if (content > MAX_CONTENT_TOKENS) throw new Error('The spoken text is too long for the model.');
  return content;
}

/** Encodes bounded mono model output as PCM WAV with a trailing thinking interval. */
export function encodeSpeechWav(samples: Float32Array, rate: number): Uint8Array {
  if (rate !== SAMPLE_RATE || samples.length === 0 || samples.length > rate * MAX_AUDIO_SECONDS) {
    throw new Error('The generated audio has an invalid size or sample rate.');
  }
  let nonzero = false;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('The generated audio is invalid.');
    if (sample !== 0) nonzero = true;
  }
  if (!nonzero) throw new Error('The generated audio is silent.');
  const dataBytes = (samples.length + rate * TRAILING_SILENCE_SECONDS) * PCM_BYTES;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (const [index, character] of Array.from(text).entries()) bytes[offset + index] = character.charCodeAt(0);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * PCM_BYTES, true);
  view.setUint16(32, PCM_BYTES, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, dataBytes, true);
  for (const [index, sample] of samples.entries()) {
    const bounded = Math.max(-1, Math.min(1, sample));
    view.setInt16(WAV_HEADER_BYTES + index * PCM_BYTES, bounded * (bounded < 0 ? PCM_NEGATIVE_PEAK : PCM_POSITIVE_PEAK), true);
  }
  return bytes;
}
