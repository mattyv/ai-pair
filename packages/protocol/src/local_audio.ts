import { z } from 'zod';
import { speechProblem } from './index';
import { localPanelAction } from './panel_action';
import { FACEPALM_BEAT_KIND_SCHEMA, FACEPALM_CUE_SCHEMA, FACEPALM_FEELING_SCHEMA, SPEECH_DELIVERY_SCHEMA } from './schemas';
import { facepalmSnapshot } from './panel_update';
import { localPanelChunk } from './panel_chunks';
import { extensionIdentity } from './local_audio_status';

/** The supported workspace-to-companion protocol version. */
export const LOCAL_AUDIO_VERSION = 13;

/** Lists the `<platform>-<arch>` hosts the bundled Kokoro runtime is built for (#39). */
export const KOKORO_HOSTS: readonly string[] = ['linux-x64', 'darwin-x64', 'darwin-arm64'];

const MAX_IDENTITY_LENGTH = 128;
const MAX_FACEPALM_FEELINGS = 6;
const MAX_FACEPALM_WINDOW_MS = 10_000;
const identity = z.string().min(1).max(MAX_IDENTITY_LENGTH);
const envelope = {
  version: z.literal(LOCAL_AUDIO_VERSION),
  connectionEpoch: identity,
  sequence: z.int().positive(),
};
const owner = { jobId: identity, pageEpoch: z.int().nonnegative() };
const facepalmOwner = { pageEpoch: z.int().positive(), generation: z.int().positive() };
const facepalmCue = FACEPALM_CUE_SCHEMA.safeExtend({ feelings: z.array(FACEPALM_FEELING_SCHEMA).min(1).max(MAX_FACEPALM_FEELINGS) });

/** Validates the allowlisted, bounded local-audio control and acknowledgement frames. */
export const localAudioFrame = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    ...facepalmOwner,
    type: z.literal('facepalmBeat'),
    requestId: z.int().positive(),
    kind: FACEPALM_BEAT_KIND_SCHEMA,
    windowMs: z.int().min(1).max(MAX_FACEPALM_WINDOW_MS),
  }),
  z.strictObject({ ...envelope, ...facepalmOwner, type: z.literal('facepalmRetire') }),
  z.strictObject({
    ...envelope,
    ...facepalmOwner,
    type: z.literal('facepalmFeel'),
    id: z.int().positive(),
    feeling: FACEPALM_FEELING_SCHEMA,
  }),
  z.strictObject({ ...envelope, type: z.literal('facepalmEnabled'), enabled: z.boolean() }),
  z.strictObject({ ...envelope, type: z.literal('facepalmRefresh') }),
  z.strictObject({ ...envelope, type: z.literal('facepalmOpenSettings') }),
  z.strictObject({
    ...envelope,
    ...facepalmOwner,
    type: z.literal('facepalmResult'),
    requestId: z.int().positive(),
    cue: facepalmCue.optional(),
  }),
  z.strictObject({ ...envelope, type: z.literal('facepalmStatus'), snapshot: facepalmSnapshot }),
  z.strictObject({ ...envelope, type: z.literal('attach') }),
  z.strictObject({ ...envelope, type: z.literal('heartbeat') }),
  localPanelChunk.safeExtend({ ...envelope, type: z.literal('panelChunk') }),
  z.strictObject({ ...envelope, type: z.literal('panelAction'), pageEpoch: z.int().nonnegative(), action: localPanelAction }),
  z.strictObject({
    ...envelope,
    ...owner,
    type: z.literal('speak'),
    delivery: SPEECH_DELIVERY_SCHEMA.optional(),
    text: z.string().refine((text) => speechProblem(text) === undefined),
  }),
  z.strictObject({ ...envelope, ...owner, type: z.literal('attentionCue') }),
  // #108: the next line to prepare ahead while one plays, and its discard on an interrupt between lines; no job owns
  // either, since a prepared line plays only through its own `speak`.
  z.strictObject({
    ...envelope,
    type: z.literal('prepareNext'),
    pageEpoch: z.int().nonnegative(),
    delivery: SPEECH_DELIVERY_SCHEMA.optional(),
    text: z.string().refine((text) => speechProblem(text) === undefined),
  }),
  z.strictObject({ ...envelope, type: z.literal('unprepare'), pageEpoch: z.int().nonnegative() }),
  z.strictObject({ ...envelope, ...owner, type: z.literal('pause') }),
  z.strictObject({ ...envelope, ...owner, type: z.literal('resume') }),
  z.strictObject({ ...envelope, ...owner, type: z.literal('cancel') }),
  z.strictObject({
    ...envelope,
    ...owner,
    type: z.literal('terminal'),
    outcome: z.enum(['ended', 'canceled', 'failed']),
  }),
]);

/** A validated local-audio command or acknowledgement. */
export type LocalAudioFrame = z.infer<typeof localAudioFrame>;

/** A bounded preparation response; preparation itself never registers a provider. */
export const localAudioPrepared = z.strictObject({
  version: z.literal(LOCAL_AUDIO_VERSION),
  epoch: identity,
  token: identity,
  /** The companion extension's own version and build, for the settings dialog and diagnostics (#115). */
  extension: extensionIdentity,
});

/** The validated response to a companion preparation request. */
export type LocalAudioPrepared = z.infer<typeof localAudioPrepared>;

/** A bounded preparation request that cannot register a provider by itself. */
export const localAudioPrepare = z.strictObject({
  version: z.literal(LOCAL_AUDIO_VERSION),
  epoch: identity,
});
