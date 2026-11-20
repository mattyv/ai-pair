import { z } from 'zod';
import { speechProblem } from './index';
import { localPanelAction } from './panel_action';
import { SPEECH_DELIVERY_SCHEMA } from './schemas';
import { localPanelChunk } from './panel_chunks';
import { extensionIdentity } from './local_audio_status';

/** The supported workspace-to-companion protocol version. */
export const LOCAL_AUDIO_VERSION = 12;

/** Lists the `<platform>-<arch>` hosts the bundled Kokoro runtime is built for (#39). */
export const KOKORO_HOSTS: readonly string[] = ['linux-x64', 'darwin-x64', 'darwin-arm64'];

const MAX_IDENTITY_LENGTH = 128;
const identity = z.string().min(1).max(MAX_IDENTITY_LENGTH);
const envelope = {
  version: z.literal(LOCAL_AUDIO_VERSION),
  connectionEpoch: identity,
  sequence: z.int().positive(),
};
const owner = { jobId: identity, pageEpoch: z.int().nonnegative() };

/** Validates the allowlisted, bounded local-audio control and acknowledgement frames. */
export const localAudioFrame = z.discriminatedUnion('type', [
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
