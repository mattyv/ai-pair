import { z } from 'zod';
import { SPEECH_SPEEDS, SPEECH_VOICES, type LocalSpeechFailureReason } from './speech_types';

/** The only protocol version the extension and its worker speak; they ship together. */
export const LOCAL_PROTOCOL_VERSION = 1;
/** The only sample rate the local engine produces. */
export const LOCAL_SAMPLE_RATE = 24_000;
/** The only sample format a result carries. */
export const LOCAL_SAMPLE_FORMAT = 'pcm16-wav';
/** Largest ordinal within a four-part unit. */
const MAX_PART_ORDINAL = 3;
/** Largest number of parts in one unit. */
export const LOCAL_MAX_PARTS = MAX_PART_ORDINAL + 1;
/** Largest supported PCM WAV, including the thinking interval and header. */
export const LOCAL_MAX_WAV_BYTES = 1_948_844;
/** The fixed PCM WAV header length. */
export const LOCAL_MIN_WAV_BYTES = 44;
/** Longest waveform including its 600 ms thinking interval. */
export const LOCAL_MAX_DURATION_MS = 40_600;
/** Maximum time for a worker to load or to finish one inference. */
export const LOCAL_WORKER_TIMEOUT_MS = 20_000;

/** The fixed failure categories a worker may report; there is never free text. */
export const LOCAL_FAILURE_CATEGORIES = ['load', 'synthesis', 'protocol', 'busy'] as const;

/** The bounded capabilities a ready worker reports, which the client checks against its own constants. */
export const LOCAL_CAPABILITIES = {
  voices: SPEECH_VOICES,
  speeds: SPEECH_SPEEDS,
  sampleRate: LOCAL_SAMPLE_RATE,
  sampleFormat: LOCAL_SAMPLE_FORMAT,
  maxWavBytes: LOCAL_MAX_WAV_BYTES,
  maxDurationMs: LOCAL_MAX_DURATION_MS,
  maxParts: LOCAL_MAX_PARTS,
} as const;

/** Checks that a list equals the expected constant list, in order. */
function sameList(expected: readonly unknown[]): (value: readonly unknown[]) => boolean {
  return (value) => value.length === expected.length && value.every((item, index) => item === expected[index]);
}

const VERSION = z.literal(LOCAL_PROTOCOL_VERSION);
const EPOCH = z.number().int().positive();
const UNIT = z.number().int().positive();
const PART = z.number().int().min(0).max(MAX_PART_ORDINAL);

/** Requests accepted by the isolated local synthesis worker. */
export const LOCAL_REQUEST = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('init'), version: VERSION, epoch: EPOCH, modelPath: z.string().min(1) }),
  z.strictObject({
    type: z.literal('synthesize'),
    version: VERSION,
    epoch: EPOCH,
    id: UNIT,
    part: PART,
    final: z.boolean(),
    text: z.string().min(1),
    voice: z.enum(SPEECH_VOICES),
    speed: z.number().refine((speed) => SPEECH_SPEEDS.some((allowed) => allowed === speed)),
  }),
  z.strictObject({ type: z.literal('shutdown'), version: VERSION }),
]);

/** Responses accepted by the extension-side client. */
export const LOCAL_RESPONSE = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ready'),
    version: VERSION,
    epoch: EPOCH,
    capabilities: z.strictObject({
      voices: z.array(z.string()).refine(sameList(LOCAL_CAPABILITIES.voices)),
      speeds: z.array(z.number()).refine(sameList(LOCAL_CAPABILITIES.speeds)),
      sampleRate: z.literal(LOCAL_CAPABILITIES.sampleRate),
      sampleFormat: z.literal(LOCAL_CAPABILITIES.sampleFormat),
      maxWavBytes: z.literal(LOCAL_CAPABILITIES.maxWavBytes),
      maxDurationMs: z.literal(LOCAL_CAPABILITIES.maxDurationMs),
      maxParts: z.literal(LOCAL_CAPABILITIES.maxParts),
    }),
  }),
  z.strictObject({
    type: z.literal('result'),
    version: VERSION,
    epoch: EPOCH,
    id: UNIT,
    part: PART,
    wav: z.instanceof(Uint8Array).refine((wav) => wav.length >= LOCAL_MIN_WAV_BYTES && wav.length <= LOCAL_MAX_WAV_BYTES),
    durationMs: z.number().positive().max(LOCAL_MAX_DURATION_MS),
  }),
  z.strictObject({
    type: z.literal('failure'),
    version: VERSION,
    epoch: EPOCH.optional(),
    id: UNIT.optional(),
    part: PART.optional(),
    category: z.enum(LOCAL_FAILURE_CATEGORIES),
  }),
]);

/** A validated request to the local synthesis worker. */
export type LocalRequest = z.infer<typeof LOCAL_REQUEST>;
/** A validated reply from the local synthesis worker. */
export type LocalResponse = z.infer<typeof LOCAL_RESPONSE>;

/** Classifies only Node's fixed error codes; never carries the error itself. */
export function localWorkerError(error: unknown): LocalSpeechFailureReason {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'worker_error';
  }
  if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
    return 'worker_module';
  }
  if (error.code === 'ERR_DLOPEN_FAILED') {
    return 'worker_native';
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return 'worker_permission';
  }
  return 'worker_error';
}
