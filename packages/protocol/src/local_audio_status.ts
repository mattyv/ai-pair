import { z } from 'zod';

/** An extension version, as diagnostics allow one: no spaces, paths, or text. */
export const extensionVersion = z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/);

/** An extension's version and build ID, as Pair Settings shows them (#115). */
export const extensionIdentity = z.strictObject({ version: extensionVersion, build: extensionVersion });

/** An extension's version and build ID. */
export type ExtensionIdentity = z.infer<typeof extensionIdentity>;

/**
 * Why a window did not connect to its companion: `not_found` means no companion answered before the
 * discovery deadline; the rest come from a companion that did (#115).
 */
export const localAudioFailure = z.enum([
  'not_found',
  'timeout',
  'activation_timeout',
  'activation_failure',
  'invalid_response',
  'protocol_mismatch',
  'epoch_mismatch',
]);

/** A reason the window did not connect to its companion. */
export type LocalAudioFailure = z.infer<typeof localAudioFailure>;

/** Where this window's companion stands, as the settings dialog and diagnostics show it (#115). */
export const localAudioStatus = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('connected'), version: extensionVersion, build: extensionVersion }),
  z.strictObject({ state: z.literal('failed'), reason: localAudioFailure }),
]);

/** Where this window's companion stands. */
export type LocalAudioStatus = z.infer<typeof localAudioStatus>;
