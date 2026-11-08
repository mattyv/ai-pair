import { z } from 'zod';
import { SPEECH_LISTENING_RATES, type SpeechTempoRate } from './speech_tempo';

const MAX_SAMPLES = 960_000;
const MAX_PART = 3;
const rate = z.custom<SpeechTempoRate>((value) => SPEECH_LISTENING_RATES.some((candidate) => candidate === value));
const pcm = z.instanceof(Int16Array).refine((value) => value.length > 0 && value.length <= MAX_SAMPLES);
const identity = {
  epoch: z.number().int().positive(),
  unitId: z.number().int().positive(),
  part: z.number().int().min(0).max(MAX_PART),
  rate,
};

/** Strict, bounded input to a local PCM tempo worker. */
export const TEMPO_REQUEST = z.strictObject({ type: z.literal('transform'), ...identity, pcm });
/** Strict, bounded result or fixed failure from a local PCM tempo worker. */
export const TEMPO_RESPONSE = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('result'), ...identity, pcm }),
  z.strictObject({ type: z.literal('failed'), ...identity, reason: z.enum(['invalid', 'failed']) }),
]);
/** A validated request accepted by the tempo worker. */
export type TempoRequest = z.infer<typeof TEMPO_REQUEST>;
/** A validated response emitted by the tempo worker. */
export type TempoResponse = z.infer<typeof TEMPO_RESPONSE>;
