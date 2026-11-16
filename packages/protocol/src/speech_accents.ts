// The accent setting for an OpenRouter model that takes audio tags (#101): its own module, so the panel's page imports
// it without the rest of the protocol.
import { z } from 'zod';

/**
 * The accents Pair Settings offers for an OpenRouter model that takes audio tags, sent as `[<accent> accent]` before
 * each line (#101). ElevenLabs lists accent tags as experimental: a model may not follow one.
 */
export const SPEECH_ACCENTS = [
  'American',
  'Australian',
  'British',
  'Canadian',
  'Indian',
  'Irish',
  'New Zealand',
  'Scottish',
  'South African',
] as const;
/** Validates the accent setting: one of `SPEECH_ACCENTS`, or the empty string for none. */
export const speechAccent = z.enum(['', ...SPEECH_ACCENTS]);
/** The accent setting: one of `SPEECH_ACCENTS`, or the empty string for none. */
export type SpeechAccent = z.infer<typeof speechAccent>;
