import { stretchSpeechPcm } from './speech_tempo';
import { TEMPO_REQUEST, type TempoResponse } from './speech_tempo_messages';

/** Validates and executes one bounded transform without exposing input in failures. */
export function runTempoRequest(raw: unknown): TempoResponse | undefined {
  const parsed = TEMPO_REQUEST.safeParse(raw);
  if (!parsed.success) return undefined;
  const { epoch, unitId, part, rate, pcm } = parsed.data;
  try {
    const result = stretchSpeechPcm(pcm, rate);
    return { type: 'result', epoch, unitId, part, rate, pcm: new Int16Array(result) };
  } catch {
    return { type: 'failed', epoch, unitId, part, rate, reason: 'failed' };
  }
}
