import { z } from 'zod';
import { SPEECH_SPEEDS, SPEECH_VOICES } from './speech_types';

/** Requests accepted by the isolated local synthesis worker. */
export const SPEECH_WORKER_INPUT = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('load'), modelPath: z.string().min(1) }),
  z.strictObject({
    type: z.literal('synthesize'),
    id: z.number().int().positive(),
    text: z.string().min(1),
    voice: z.enum(SPEECH_VOICES),
    speed: z.number().refine((speed) => SPEECH_SPEEDS.some((allowed) => allowed === speed)),
  }),
]);

/** Responses accepted by the extension-side speech service. */
export const SPEECH_WORKER_OUTPUT = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('audio'),
    id: z.number().int().positive(),
    wav: z.instanceof(Uint8Array),
    durationMs: z.number().positive(),
  }),
  z.strictObject({ type: z.literal('error'), id: z.number().int().positive().optional(), message: z.string().min(1) }),
]);

/** A validated reply from the local synthesis worker. */
export type SpeechWorkerOutput = z.infer<typeof SPEECH_WORKER_OUTPUT>;
