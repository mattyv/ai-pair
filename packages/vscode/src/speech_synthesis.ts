import { checkedTokenCount, encodeSpeechWav } from './speech_audio';
import type { SpeechVoice } from './speech_types';

/** A model token tensor, whose final dimension counts boundary and content tokens. */
export interface SpeechTokens {
  dims: readonly number[];
}

/** The inference operations isolated behind the worker's model boundary. */
export interface SpeechEngine<T extends SpeechTokens> {
  phonemize(text: string, language: 'a' | 'b'): Promise<string>;
  tokenize(phonemes: string): T;
  generate(tokens: T, voice: SpeechVoice, speed: number): Promise<{ samples: Float32Array; rate: number }>;
}

/** The bounded speech unit and its selected voice and speed. */
export interface SpeechRequest {
  text: string;
  voice: SpeechVoice;
  speed: number;
}

/** Encodes a checked model result and its playback duration. */
export interface SynthesizedSpeech {
  wav: Uint8Array;
  durationMs: number;
}

/** The extra thinking interval appended to successful audio. */
const TRAILING_SILENCE_MS = 600;
/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** Converts one complete text into bounded audio without truncating its tokens. */
export async function synthesizeSpeech<T extends SpeechTokens>(
  engine: SpeechEngine<T>,
  request: SpeechRequest,
): Promise<SynthesizedSpeech> {
  const language = request.voice.startsWith('b') ? 'b' : 'a';
  const phonemes = await engine.phonemize(request.text, language);
  const tokens = engine.tokenize(phonemes);
  checkedTokenCount(tokens.dims.at(-1) ?? 0);
  const audio = await engine.generate(tokens, request.voice, request.speed);
  const wav = encodeSpeechWav(audio.samples, audio.rate);
  return { wav, durationMs: (audio.samples.length / audio.rate) * MS_PER_SECOND + TRAILING_SILENCE_MS };
}
