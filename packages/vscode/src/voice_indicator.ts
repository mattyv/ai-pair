import type { AudioDiagnostics } from '@ai-pair/protocol';
import type { SpeechComputeState } from './speech_compute_types';

/** The conservative view of the host's cached speech facts. */
export type VoiceIndicator = 'off' | 'checking' | 'ready' | 'unavailable';

/** Projects existing evidence without starting a probe or promising audible playback. */
export function voiceIndicator(
  facts: AudioDiagnostics | undefined,
  compute: SpeechComputeState | undefined,
  transport: boolean,
  settingsValid: boolean | undefined,
): VoiceIndicator {
  // specs/VoiceIndicator.tla, Observe: update the view from the current facts together.
  if (facts === undefined) return 'checking';
  if (!facts.enabled) return 'off';
  if (
    !transport ||
    facts.lastPlayback === 'failed' ||
    !facts.voiceConfigured ||
    facts.routeAvailable === false ||
    settingsValid === false
  ) {
    return 'unavailable';
  }
  if (settingsValid === undefined) return 'checking';
  if (facts.routeAvailable === 'unknown') return 'checking';
  if (facts.provider === 'elevenlabs') {
    if (facts.keyConfigured === 'unknown') return 'checking';
    return facts.keyConfigured ? 'ready' : 'unavailable';
  }
  if (facts.runtimeReady === false || facts.modelReady === false) return 'unavailable';
  if (facts.runtimeReady === 'unknown' || facts.modelReady === 'unknown' || compute === undefined) return 'checking';
  if (compute.requestedMode === 'gpu' && compute.actualBackend !== 'gpu') {
    if (compute.gpuCheck.phase === 'unavailable') return 'unavailable';
    if (compute.gpuCheck.phase !== 'ready') return 'checking';
  }
  return 'ready';
}
