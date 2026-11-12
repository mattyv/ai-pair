import { z } from 'zod';

const MAX_WAV_BASE64 = 2_598_460;
const MAX_AUDIO_BASE64 = 20_480_000;
const MAX_DURATION_MS = 40_600;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96_000;
const identity = z.number().int().positive();
const token = z.uuid();
const document = z.strictObject({ pageId: identity, documentGeneration: identity });
const decoded = z.strictObject({ wavBase64: z.string().max(MAX_WAV_BASE64), durationMs: z.number().positive().max(MAX_DURATION_MS) });

/** Local-only messages from the browser decoder to its owning extension host. */
export const speechDecodeFromPage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('speechDecodeBoot'), token }),
  z.strictObject({ type: z.literal('speechDecodeBootAck'), token, document }),
  z.strictObject({ type: z.literal('speechDecodeReady'), token, document, probeId: identity, available: z.boolean() }),
  z.strictObject({ type: z.literal('speechDecodeDone'), token, document, requestId: identity, value: decoded.optional() }),
]);

/** Local-only messages from the owning extension host to its browser decoder. */
export const speechDecodeToPage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('speechDecodeChallenge'), token, document }),
  z.strictObject({ type: z.literal('speechDecodeProbe'), token, document, probeId: identity }),
  z.strictObject({
    type: z.literal('speechDecode'),
    token,
    document,
    requestId: identity,
    speechId: identity,
    format: z.enum(['mp3', 'pcm']),
    audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64),
    sampleRate: z.number().int().min(MIN_SAMPLE_RATE).max(MAX_SAMPLE_RATE).optional(),
    channels: z.number().int().min(1).max(2).optional(),
  }),
]);

/** A validated decoder message posted by the local browser. */
export type SpeechDecodeFromPage = z.infer<typeof speechDecodeFromPage>;
/** A validated decoder message delivered to the local browser. */
export type SpeechDecodeToPage = z.infer<typeof speechDecodeToPage>;
