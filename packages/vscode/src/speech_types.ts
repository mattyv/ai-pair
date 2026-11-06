/** The voices available for selected local narration. */
export const SPEECH_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george'] as const;
/** A supported local voice. */
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
/** The supported independent speech rates. */
export const SPEECH_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** The sentence shown and spoken during voice preview. */
export const SPEECH_PREVIEW_TEXT = 'Here is a short example of the voice for our pairing session.';
/** Preferences sampled when a new narration unit starts. */
export interface SpeechSettings {
  enabled: boolean;
  voice: SpeechVoice;
  speed: number;
}
