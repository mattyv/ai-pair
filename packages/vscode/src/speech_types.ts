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
  provider: SpeechProvider;
  elevenLabsVoice: string;
  elevenLabsSpeed: number;
  voice: string;
  speed: number;
}

/** The explicit narration provider, sampled at admission. */
export type SpeechProvider = 'kokoro' | 'elevenlabs';
/** Supported ElevenLabs rates, independent of code playback speed. */
// The list is the set of supported cloud rates.
// oxlint-disable-next-line eslint/no-magic-numbers
export const ELEVENLABS_SPEEDS = [0.75, 1, 1.2] as const;
/** Audio accepted by the shared page playback path. */
export interface SpeechAudioResult {
  wav: Uint8Array;
  durationMs: number;
}
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
