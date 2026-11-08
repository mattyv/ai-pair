import { ELEVENLABS_SPEEDS, SPEECH_SPEEDS, SPEECH_VOICES, type SpeechSettings } from './speech_types';

/** Current, locally checked conditions for a speech reminder. */
export interface SpeechReadiness {
  settings(): SpeechSettings;
  desktop(): boolean;
  local(): boolean;
  output(): boolean;
  model(): Promise<boolean>;
  key(): Promise<boolean>;
}

/** Checks speech availability without synthesizing or contacting a provider. */
export async function speechReady(options: SpeechReadiness): Promise<boolean> {
  const settings = options.settings();
  const snapshot = JSON.stringify(settings);
  if (!settings.enabled || !options.desktop() || !options.output()) return false;
  let available: boolean;
  if (settings.provider === 'kokoro') {
    if (
      !options.local() ||
      !SPEECH_VOICES.some((voice) => voice === settings.voice) ||
      !SPEECH_SPEEDS.some((speed) => speed === settings.speed)
    ) {
      return false;
    }
    available = await options.model();
  } else {
    if (settings.elevenLabsVoice.length === 0 || !ELEVENLABS_SPEEDS.some((speed) => speed === settings.elevenLabsSpeed)) return false;
    available = await options.key();
  }
  return (
    available &&
    snapshot === JSON.stringify(options.settings()) &&
    options.desktop() &&
    options.output() &&
    (settings.provider !== 'kokoro' || options.local())
  );
}
