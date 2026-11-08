import { z } from 'zod';

const rate = z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]);
const pcm = z.instanceof(Int16Array).refine((value) => value.length > 0 && value.length <= 960_000);
const owner = { epoch: z.number().int().positive(), unitId: z.number().int().positive(), part: z.number().int().min(0).max(3), rate };
/** A test double for the local worker request validator. */
export const TEMPO_REQUEST = z.strictObject({ type: z.literal('transform'), ...owner, pcm });
/** A test double for the local worker response validator. */
export const TEMPO_RESPONSE = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('result'), ...owner, pcm }),
  z.strictObject({ type: z.literal('failed'), ...owner, reason: z.enum(['invalid', 'failed']) }),
]);
