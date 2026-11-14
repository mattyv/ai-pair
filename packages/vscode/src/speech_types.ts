import { SPEECH_LISTENING_RATES, type SpeechTempoRate } from './speech_tempo';

/** The voices available for selected local narration. */
export const SPEECH_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george'] as const;
/** A supported local voice. */
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
/** The supported independent speech rates. */
// The list is the set of supported rates.
// oxlint-disable-next-line eslint/no-magic-numbers
export const SPEECH_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** The sentence shown and spoken during voice preview. */
export const SPEECH_PREVIEW_TEXT = 'Here is a short example of the voice for our pairing session.';
/** Preferences sampled when a new narration unit starts. */
export interface SpeechSettings {
  enabled: boolean;
  /** Enables supported narration continuity and delivery cues. */
  contextEnabled?: boolean;
  /** Independent listening speed; absent older settings mean normal speed. */
  listeningSpeed?: number;
  provider: SpeechProvider;
  elevenLabsVoice: string;
  elevenLabsSpeed: number;
  openRouterModel?: string;
  openRouterVoice?: string;
  openRouterZdr?: boolean;
  openRouterFormat?: OpenRouterAudioFormat;
  voice: string;
  speed: number;
}

/** The explicit narration provider, sampled at admission. */
export type SpeechProvider = 'kokoro' | 'elevenlabs' | 'openrouter';
/** Supported ElevenLabs rates, independent of code playback speed. */
// The list is the set of supported cloud rates.
// oxlint-disable-next-line eslint/no-magic-numbers
export const ELEVENLABS_SPEEDS = [0.75, 1, 1.2] as const;
/** Audio accepted by the shared page playback path. */
export interface SpeechAudioResult {
  wav: Uint8Array;
  durationMs: number;
}
/** Response format requested from OpenRouter. */
export type OpenRouterAudioFormat = 'pcm' | 'mp3';
/** Safe fields displayed for an account voice. */
export interface ElevenLabsVoice {
  id: string;
  name: string;
  category?: string;
}
/** One bounded account voice page. */
export interface ElevenLabsVoicePage {
  voices: ElevenLabsVoice[];
  nextCursor?: string;
}
/** Cloud provider operations; credentials stay inside the provider. */
export interface ElevenLabsSpeechPort {
  synthesize(request: { text: string; voiceId: string; speed: number }, signal: AbortSignal): Promise<SpeechAudioResult>;
  voices(cursor: string | undefined, signal: AbortSignal): Promise<ElevenLabsVoicePage>;
}

/** A voice supported by an account-accessible OpenRouter model. */
export interface OpenRouterVoice {
  id: string;
  name: string;
}
/** A bounded, account-accessible speech model and its voices. */
export interface OpenRouterModel {
  id: string;
  name: string;
  voices: OpenRouterVoice[];
  pricing?: { prompt?: string; completion?: string };
}
/** OpenRouter operations retain credentials inside the provider. */
export interface OpenRouterSpeechPort {
  synthesize(
    request: {
      id: number;
      text: string;
      modelId: string;
      voiceId: string;
      zdr: boolean;
      format: OpenRouterAudioFormat;
      purpose?: 'narration' | 'preview';
      previousText?: string;
    },
    signal: AbortSignal,
  ): Promise<SpeechAudioResult>;
  models(zdr: boolean, signal: AbortSignal): Promise<OpenRouterModel[]>;
}
/** One locally owned decoder request reserved before its paid provider call. */
export interface OpenRouterAudioDecodeLease {
  /** Aborted when its owning document or admission is revoked. */
  readonly signal: AbortSignal;
  decode(input: OpenRouterAudioInput, signal: AbortSignal): Promise<SpeechAudioResult>;
  /** Invalidates logical work; a running browser decode keeps its physical slot until settlement. */
  cancel(): void;
}
/** A bounded OpenRouter audio response with PCM layout when applicable. */
export type OpenRouterAudioInput =
  { format: 'mp3'; bytes: Uint8Array } | { format: 'pcm'; bytes: Uint8Array; sampleRate: number; channels: number };
/** Admits local browser decoding before any OpenRouter synthesis POST. */
export interface OpenRouterAudioDecoder {
  admit(speechId: number, signal: AbortSignal): Promise<OpenRouterAudioDecodeLease>;
}

/** Safe local worker failure categories, without exception text or paths. */
export type LocalSpeechFailureReason =
  | 'runtime_missing'
  | 'model_missing'
  | 'worker_module'
  | 'worker_native'
  | 'worker_permission'
  | 'worker_error'
  | 'worker_exit'
  | 'model_load'
  | 'synthesis'
  | 'timeout'
  | 'audio_page';

/** Normalizes absent, unsupported, or malformed listening speed. */
export function speechListeningRate(value: unknown): SpeechTempoRate {
  return SPEECH_LISTENING_RATES.find((rate) => rate === value) ?? 1;
}
