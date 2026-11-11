import { z } from 'zod';

const MAX_MODELS = 500;
const MAX_VOICES = 500;
const MAX_NAME = 160;
const MAX_MODEL_ID = 256;
const MAX_INPUT = 10_000;
const voice = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);

/** The speech models whose PCM format is documented as 24 kHz mono. */
export const openRouterModelId = z.enum(['microsoft/mai-voice-2', 'microsoft/mai-voice-2.1', 'microsoft/mai-voice-2.1-flash']);
/** Validates a bounded catalog envelope while retaining model details for further validation. */
export const openRouterCatalog = z.object({ data: z.array(z.looseObject({ id: z.string().min(1).max(MAX_MODEL_ID) })).max(MAX_MODELS) });
/** Validates the displayed fields of a supported speech model. */
export const openRouterSpeechModel = z.object({
  id: openRouterModelId,
  name: z.string().min(1).max(MAX_NAME),
  supported_voices: z.array(voice).max(MAX_VOICES),
});
/** Validates an allowlisted bounded speech request. */
export const openRouterSpeechRequest = z.strictObject({
  model: openRouterModelId,
  voice,
  input: z.string().min(1).max(MAX_INPUT),
  response_format: z.literal('pcm'),
  provider: z.strictObject({ zdr: z.literal(true) }).optional(),
});
/** The validated provider speech request. */
export type OpenRouterSpeechRequest = z.infer<typeof openRouterSpeechRequest>;
/** The validated displayed model fields. */
export type OpenRouterSpeechModel = z.infer<typeof openRouterSpeechModel>;
