import type { OpenRouterAudioInput, SpeechAudioResult } from '../speech_types';
import { speechDecodeToPage, type SpeechDecodeFromPage } from '@ai-pair/protocol/speech_decode';

const OUTPUT_RATE = 24_000;
const MAX_SECONDS = 40;
const TAIL_SECONDS = 0.6;
const HEADER = 44;
const SCALE = 32_768;
const MIN_RATE = 8000;
const MAX_RATE = 96_000;
const MS_PER_SECOND = 1000;
/** Original 50 ms, 440 Hz sine, encoded locally at 24 kHz with libmp3lame 3.100. */
const MP3_PROBE =
  '//NAxAATUKpcAVowADBgzBhTChTDhzDhQEHWekYYAAY8mZ1ObFyb+CcF2bNSZ0iBh6YamjOGGLsXYzhyH8lgWDgMBgMBkydxBhAggCEuD4f/9/Kef5T39Hv6FQKCBgyCFwkAvJeJjGP/80LEDRcJXmwBnYAAIYSNikIZLDATCQYsQoaLhMYShQCp+GgQMiwuUBAWQbBINqq+KSEFg+L8ckXKLlJr/IMOcUSKkV/8yLxNGJdLqX/+Xi8iCoiCv/BURBUFSyrailUqgIwoFAAARIP/80DEDBYJTnQBnJAApi+wMPM2lcyqHzNE5NQBJH8HdlFs2IHkoOhgFgJtC6vtilRKZt/jNlIghPf+RREnDpP//6Jfm6jQ9/lCgnE5f/+ICCCZNLP/+hCCdNWAkegKAymMoEkkEJsueP/zQsQOFSDaWAHYSAHIQYUCaHnB5qOgNW0YUG1ha2BGHKmWMy6Hs6VERCpFMhCoIgiTTQiklQ5UoxjlSRIkRIKCugw3wUFeCiuBP+FBXwjvN/8QVUxBTUUzLjEwMFVVVVVVVVVVVVVVVQ==';
/** Fixed fields in a PCM WAV header. */
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
  bits: 34,
  data: 36,
  dataSize: 40,
  formatBytes: 16,
  sampleBits: 16,
} as const;

interface BrowserAudioBuffer {
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}
interface OfflineAudioDecoder {
  decodeAudioData(bytes: ArrayBuffer): Promise<BrowserAudioBuffer>;
}

/** Locates the browser API without requiring browser globals in the host build. */
function offlineContext(): (new (channels: number, length: number, sampleRate: number) => OfflineAudioDecoder) | undefined {
  // The browser owns this global; the extension host compiles this module for its tests too.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const scope = globalThis as typeof globalThis & {
    OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioDecoder;
  };
  return scope.OfflineAudioContext;
}

/** Decoded planar samples supplied by the browser codec. */
export interface DecodedSamples {
  sampleRate: number;
  channels: Float32Array[];
}

/** Decodes MP3 using the browser's audio codec without opening an output device. */
export async function decodeMp3(bytes: Uint8Array): Promise<DecodedSamples> {
  const Context = offlineContext();
  if (Context === undefined) throw new Error('Decoder unavailable');
  const context = new Context(1, 1, OUTPUT_RATE);
  const audio = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
  return {
    sampleRate: audio.sampleRate,
    channels: Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)),
  };
}

/** Normalizes bounded OpenRouter PCM or MP3 into 24 kHz mono PCM WAV. */
export async function decodeSpeech(
  input: OpenRouterAudioInput,
  decode: (bytes: Uint8Array) => Promise<DecodedSamples>,
): Promise<SpeechAudioResult> {
  let decoded: DecodedSamples;
  if (input.format === 'mp3') {
    decoded = await decode(input.bytes);
  } else {
    const frameBytes = input.channels * 2;
    if (
      !Number.isInteger(input.sampleRate) ||
      input.sampleRate < MIN_RATE ||
      input.sampleRate > MAX_RATE ||
      (input.channels !== 1 && input.channels !== 2) ||
      input.bytes.length === 0 ||
      input.bytes.length % frameBytes !== 0 ||
      input.bytes.length > input.sampleRate * MAX_SECONDS * frameBytes
    ) {
      throw new Error('Invalid PCM');
    }
    const data = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    const channels = Array.from({ length: input.channels }, () => new Float32Array(input.bytes.length / frameBytes));
    const frames = input.bytes.length / frameBytes;
    for (let frame = 0; frame < frames; frame++) {
      for (const [channel, target] of channels.entries()) {
        target[frame] = data.getInt16(frame * frameBytes + channel * 2, true) / SCALE;
      }
    }
    decoded = { sampleRate: input.sampleRate, channels };
  }
  const { channels, sampleRate } = decoded;
  const sourceLength = channels[0]?.length ?? 0;
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < MIN_RATE ||
    sampleRate > MAX_RATE ||
    channels.length < 1 ||
    channels.length > 2 ||
    sourceLength === 0 ||
    sourceLength > sampleRate * MAX_SECONDS ||
    channels.some((channel) => channel.length !== sourceLength)
  ) {
    throw new Error('Invalid decoded audio');
  }
  const frames = Math.ceil((sourceLength * OUTPUT_RATE) / sampleRate);
  const tail = OUTPUT_RATE * TAIL_SECONDS;
  const wav = new Uint8Array(HEADER + (frames + tail) * 2);
  const view = new DataView(wav.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [WAV.wave, 'WAVE'],
    [WAV.format, 'fmt '],
    [WAV.data, 'data'],
  ] as const) {
    wav.set(new TextEncoder().encode(text), offset);
  }
  view.setUint32(WAV.riffSize, wav.length - WAV.riffPrefix, true);
  view.setUint32(WAV.formatSize, WAV.formatBytes, true);
  view.setUint16(WAV.pcmCode, 1, true);
  view.setUint16(WAV.channels, 1, true);
  view.setUint32(WAV.sampleRate, OUTPUT_RATE, true);
  view.setUint32(WAV.byteRate, OUTPUT_RATE * 2, true);
  view.setUint16(WAV.blockAlign, 2, true);
  view.setUint16(WAV.bits, WAV.sampleBits, true);
  view.setUint32(WAV.dataSize, wav.length - HEADER, true);
  let nonzero = false;
  for (let frame = 0; frame < frames; frame++) {
    const source = (frame * sampleRate) / OUTPUT_RATE;
    const left = Math.floor(source);
    const right = Math.min(left + 1, sourceLength - 1);
    const fraction = source - left;
    let sample = 0;
    for (const channel of channels) {
      const first = channel[left];
      const second = channel[right];
      if (first === undefined || second === undefined || !Number.isFinite(first) || !Number.isFinite(second)) {
        throw new Error('Invalid decoded audio');
      }
      sample += (first + (second - first) * fraction) / channels.length;
    }
    const bounded = Math.max(-1, Math.min(1, sample));
    const value = Math.round(bounded * (bounded < 0 ? SCALE : SCALE - 1));
    if (value !== 0) nonzero = true;
    view.setInt16(HEADER + frame * 2, value, true);
  }
  if (!nonzero) throw new Error('Silent decoded audio');
  return { wav, durationMs: (frames / OUTPUT_RATE + TAIL_SECONDS) * MS_PER_SECOND };
}

/** Handles decoder messages in the local browser document. */
export function localSpeechDecoder(post: (message: SpeechDecodeFromPage) => void, token: string): (value: unknown) => boolean {
  let current: { pageId: number; documentGeneration: number } | undefined;
  let readiness: Promise<boolean> | undefined;
  post({ type: 'speechDecodeBoot', token });
  return (value) => {
    const parsed = speechDecodeToPage.safeParse(value);
    if (!parsed.success) return false;
    const message = parsed.data;
    if (message.token !== token) {
      if (message.type === 'speechDecodeChallenge') post({ type: 'speechDecodeBoot', token });
      return true;
    }
    if (message.type === 'speechDecodeChallenge') {
      current = message.document;
      post({ type: 'speechDecodeBootAck', token, document: current });
      return true;
    }
    if (
      current === undefined ||
      current.pageId !== message.document.pageId ||
      current.documentGeneration !== message.document.documentGeneration
    ) {
      return true;
    }
    if (message.type === 'speechDecodeProbe') {
      // atob yields Latin-1 code units, each of which is exactly one byte.
      // oxlint-disable-next-line unicorn/prefer-code-point
      readiness ??= decodeMp3(Uint8Array.from(atob(MP3_PROBE), (character) => character.charCodeAt(0))).then(
        (audio) => audio.channels.length > 0 && audio.channels.some((channel) => channel.some((sample) => sample !== 0)),
        () => false,
      );
      const probe = readiness;
      void probe.then((available) => {
        if (!available && readiness === probe) readiness = undefined;
        post({ type: 'speechDecodeReady', token, document: message.document, probeId: message.probeId, available });
      });
      return true;
    }
    void (async () => {
      try {
        const raw = atob(message.audioBase64);
        // atob yields Latin-1 code units, each of which is exactly one byte.
        // oxlint-disable-next-line unicorn/prefer-code-point
        const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
        const input: OpenRouterAudioInput =
          message.format === 'mp3'
            ? { format: 'mp3', bytes }
            : { format: 'pcm', bytes, sampleRate: message.sampleRate ?? 0, channels: message.channels ?? 0 };
        const output = await decodeSpeech(input, decodeMp3);
        let binary = '';
        for (const byte of output.wav) binary += String.fromCodePoint(byte);
        post({
          type: 'speechDecodeDone',
          token,
          document: message.document,
          requestId: message.requestId,
          value: { wavBase64: btoa(binary), durationMs: output.durationMs },
        });
      } catch {
        post({ type: 'speechDecodeDone', token, document: message.document, requestId: message.requestId });
      }
    })();
    return true;
  };
}
