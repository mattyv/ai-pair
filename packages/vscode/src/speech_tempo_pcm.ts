import type { SpeechAudioResult } from './speech_types';

const SAMPLE_RATE = 24_000;
const MAX_AUDIO_SECONDS = 40;
const TAIL_SAMPLES = 14_400;
const HEADER_BYTES = 44;
const PCM_BYTES = 2;
const IDENTIFIER_BYTES = 4;
const MS_PER_SECOND = 1000;
// Fixed PCM WAV header offsets and values.
// oxlint-disable-next-line eslint/no-magic-numbers
const WAV = {
  riffSize: 4,
  riffPrefix: 8,
  wave: 8,
  fmt: 12,
  fmtSize: 16,
  format: 20,
  channels: 22,
  rate: 24,
  byteRate: 28,
  alignment: 32,
  bits: 34,
  data: 36,
  dataSize: 40,
  formatBytes: 16,
  bitsPerSample: 16,
} as const;

/** Reads the four ASCII bytes of one fixed WAV chunk identifier. */
function identifier(wav: Uint8Array, offset: number): string {
  return String.fromCodePoint(...wav.subarray(offset, offset + IDENTIFIER_BYTES));
}

/** Extracts validated mono PCM16 samples and removes the known final silent tail. */
export function decodeSpeechWav(wav: Uint8Array, final: boolean): Int16Array {
  if (wav.length < HEADER_BYTES) throw new Error('Speech waveform is invalid.');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const dataBytes = view.getUint32(WAV.dataSize, true);
  if (
    identifier(wav, 0) !== 'RIFF' ||
    identifier(wav, WAV.wave) !== 'WAVE' ||
    identifier(wav, WAV.fmt) !== 'fmt ' ||
    identifier(wav, WAV.data) !== 'data' ||
    view.getUint32(WAV.riffSize, true) !== wav.length - WAV.riffPrefix ||
    view.getUint32(WAV.fmtSize, true) !== WAV.formatBytes ||
    view.getUint16(WAV.format, true) !== 1 ||
    view.getUint16(WAV.channels, true) !== 1 ||
    view.getUint32(WAV.rate, true) !== SAMPLE_RATE ||
    view.getUint32(WAV.byteRate, true) !== SAMPLE_RATE * PCM_BYTES ||
    view.getUint16(WAV.alignment, true) !== PCM_BYTES ||
    view.getUint16(WAV.bits, true) !== WAV.bitsPerSample ||
    dataBytes !== wav.length - HEADER_BYTES ||
    dataBytes % PCM_BYTES !== 0
  ) {
    throw new Error('Speech waveform is invalid.');
  }
  const total = dataBytes / PCM_BYTES;
  const length = total - (final ? TAIL_SAMPLES : 0);
  if (length <= 0 || length > SAMPLE_RATE * MAX_AUDIO_SECONDS) throw new Error('Speech waveform is invalid.');
  if (final) {
    for (let index = length; index < total; index++) {
      if (view.getInt16(HEADER_BYTES + index * PCM_BYTES, true) !== 0) throw new Error('Speech waveform is invalid.');
    }
  }
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index++) pcm[index] = view.getInt16(HEADER_BYTES + index * PCM_BYTES, true);
  return pcm;
}

/** Frames exact PCM16 samples and optionally appends the one final thinking tail. */
export function encodeTempoWav(pcm: Int16Array, final: boolean): SpeechAudioResult {
  if (pcm.length === 0 || pcm.length > SAMPLE_RATE * MAX_AUDIO_SECONDS) throw new Error('Speech waveform is invalid.');
  const sampleCount = pcm.length + (final ? TAIL_SAMPLES : 0);
  const wav = new Uint8Array(HEADER_BYTES + sampleCount * PCM_BYTES);
  const view = new DataView(wav.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [WAV.wave, 'WAVE'],
    [WAV.fmt, 'fmt '],
    [WAV.data, 'data'],
  ] as const) {
    wav.set(Buffer.from(text, 'ascii'), offset);
  }
  view.setUint32(WAV.riffSize, wav.length - WAV.riffPrefix, true);
  view.setUint32(WAV.fmtSize, WAV.formatBytes, true);
  view.setUint16(WAV.format, 1, true);
  view.setUint16(WAV.channels, 1, true);
  view.setUint32(WAV.rate, SAMPLE_RATE, true);
  view.setUint32(WAV.byteRate, SAMPLE_RATE * PCM_BYTES, true);
  view.setUint16(WAV.alignment, PCM_BYTES, true);
  view.setUint16(WAV.bits, WAV.bitsPerSample, true);
  view.setUint32(WAV.dataSize, sampleCount * PCM_BYTES, true);
  for (const [index, sample] of pcm.entries()) view.setInt16(HEADER_BYTES + index * PCM_BYTES, sample, true);
  return { wav, durationMs: (sampleCount / SAMPLE_RATE) * MS_PER_SECOND };
}
