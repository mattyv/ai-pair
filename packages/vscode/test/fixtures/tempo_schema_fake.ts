import { z } from 'zod';

const rate = z
  .number()
  .refine((value) => [0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5].includes(value));
const pcm = z.instanceof(Int16Array).refine((value) => value.length > 0 && value.length <= 960_000);
const owner = { epoch: z.number().int().positive(), unitId: z.number().int().positive(), part: z.number().int().min(0).max(3), rate };
/** A test double for the local worker request validator. */
export const TEMPO_REQUEST = z.strictObject({ type: z.literal('transform'), ...owner, pcm });
/** A test double for the local worker response validator. */
export const TEMPO_RESPONSE = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('result'), ...owner, pcm }),
  z.strictObject({ type: z.literal('failed'), ...owner, reason: z.literal('failed') }),
]);
