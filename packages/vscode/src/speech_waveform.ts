/** The Kokoro model accepts 510 content tokens between two boundary tokens. */
const MAX_CONTENT_TOKENS = 510;
/** Kokoro's tokenizer adds a start and an end token. */
const BOUNDARY_TOKENS = 2;
/** Kokoro produces mono audio at this sample rate. */
const SAMPLE_RATE = 24_000;
/** The largest waveform accepted before the thinking interval. */
const MAX_AUDIO_SECONDS = 40;
/** The thinking interval appended to a successful waveform. */
const TRAILING_SILENCE_SECONDS = 0.6;
/** A PCM WAV header contains 44 bytes. */
const WAV_HEADER_BYTES = 44;
/** A 16-bit signed PCM sample uses two bytes. */
const PCM_BYTES = 2;
/** Fixed offsets and field values in the PCM WAV header. */
// oxlint-disable-next-line eslint/no-magic-numbers
const WAV = {
  riffSize: 4,
  riffPrefix: 8,
  wave: 8,
  format: 12,
  formatSize: 16,
  pcmCode: 20,
  channels: 22,
  sampleRate: 24,
  byteRate: 28,
  blockAlign: 32,
  bitsPerSample: 34,
  data: 36,
  dataSize: 40,
  formatBytes: 16,
  sampleBits: 16,
} as const;
/** The positive peak of a signed 16-bit sample. */
const PCM_POSITIVE_PEAK = 32_767;
/** The absolute negative peak of a signed 16-bit sample. */
const PCM_NEGATIVE_PEAK = 32_768;

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
  for (const [offset, text] of [
    [0, 'RIFF'],
    [WAV.wave, 'WAVE'],
    [WAV.format, 'fmt '],
    [WAV.data, 'data'],
  ] as const) {
    bytes.set(Buffer.from(text, 'ascii'), offset);
  }
  view.setUint32(WAV.riffSize, bytes.length - WAV.riffPrefix, true);
  view.setUint32(WAV.formatSize, WAV.formatBytes, true);
  view.setUint16(WAV.pcmCode, 1, true);
  view.setUint16(WAV.channels, 1, true);
  view.setUint32(WAV.sampleRate, rate, true);
  view.setUint32(WAV.byteRate, rate * PCM_BYTES, true);
  view.setUint16(WAV.blockAlign, PCM_BYTES, true);
  view.setUint16(WAV.bitsPerSample, WAV.sampleBits, true);
  view.setUint32(WAV.dataSize, dataBytes, true);
  for (const [index, sample] of samples.entries()) {
    const bounded = Math.max(-1, Math.min(1, sample));
    view.setInt16(WAV_HEADER_BYTES + index * PCM_BYTES, bounded * (bounded < 0 ? PCM_NEGATIVE_PEAK : PCM_POSITIVE_PEAK), true);
  }
  return bytes;
}
