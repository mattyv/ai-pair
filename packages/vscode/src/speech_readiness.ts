import { ELEVENLABS_SPEEDS, SPEECH_SPEEDS, SPEECH_VOICES, type SpeechSettings } from './speech_types';

/** Current, locally checked conditions for a speech reminder. */
export interface SpeechReadiness {
  settings(): SpeechSettings;
  desktop(): boolean;
  local(): boolean;
  output(): boolean;
  model(): Promise<boolean>;
  key(provider: 'elevenlabs' | 'openrouter'): Promise<boolean>;
  openRouterAllowed?: (model: string, voice: string) => boolean;
}

/** Checks speech availability without synthesizing or contacting a provider. */
export async function speechReady(options: SpeechReadiness): Promise<boolean> {
  const settings = options.settings();
  const snapshot = JSON.stringify(settings);
  if (!settings.enabled || !options.desktop() || !options.output()) return false;
  const openRouterModel = settings.openRouterModel ?? '';
  const openRouterVoice = settings.openRouterVoice ?? '';
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
  } else if (settings.provider === 'elevenlabs') {
    if (settings.elevenLabsVoice.length === 0 || !ELEVENLABS_SPEEDS.some((speed) => speed === settings.elevenLabsSpeed)) return false;
    available = await options.key('elevenlabs');
  } else {
    if (openRouterModel.length === 0 || openRouterVoice.length === 0) return false;
    if (options.openRouterAllowed?.(openRouterModel, openRouterVoice) === false) return false;
    available = await options.key('openrouter');
  }
  return (
    available &&
    snapshot === JSON.stringify(options.settings()) &&
    options.desktop() &&
    options.output() &&
    (settings.provider !== 'kokoro' || options.local()) &&
    (settings.provider !== 'openrouter' || options.openRouterAllowed?.(openRouterModel, openRouterVoice) !== false)
  );
}
