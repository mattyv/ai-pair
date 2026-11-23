// The wire protocol between AI Pair and Facepalm's daemon (github.com/mattyv/facepalm), over its
// per-user socket (ai-pair#83, item 14 of facepalm#61): a request is one line of text, a reply one
// line of JSON, as facepalm's own src/protocol.h documents. specs/FacepalmSubscription.tla models
// AI Pair's side of the subscription this builds requests for.

import { z } from 'zod';
import { FACEPALM_BEAT_KIND_SCHEMA, FACEPALM_CUE_SCHEMA, type FacepalmBeatKind, type FacepalmFeeling } from './schemas';

/** The longest a client's name may be (facepalm's `IsName`). */
const MAX_FACEPALM_NAME = 64;
/** The name AI Pair approves itself under: `facepalm-daemon approve ai-pair`. */
export const FACEPALM_CLIENT_NAME = 'ai-pair';
/** Facepalm's `beat`'s shortest and longest window, in milliseconds. */
export const FACEPALM_MIN_BEAT_MS = 1;
export const FACEPALM_MAX_BEAT_MS = 10_000;
/** The window AI Pair asks for when it has no reason to ask for another. */
export const FACEPALM_DEFAULT_BEAT_MS = 1500;

/** Facepalm's `{"ok":true}` reply to `hello` and `feel`. */
export const FACEPALM_OK_SCHEMA = z.strictObject({ ok: z.literal(true) });

/** Facepalm's `{"error":"..."}` reply to a request it refused. */
export const FACEPALM_ERROR_SCHEMA = z.strictObject({ error: z.string() });

/**
 * A `beat`'s reply: the readings since this client last looked, which AI Pair doesn't use, and,
 * once the window ends, Facepalm's read of it: a feeling, and where the programmer was looking
 * over the window (`gaze`, facepalm#142), carried as context alongside it. Facepalm's own reply can
 * also carry `content`, whether that gaze landed inside a rectangle the beat gave it, but only when
 * the beat carried one; AI Pair never does (#143's own finding: no reliable way for it to place a
 * rectangle on screen), so this schema has no field for it.
 */
export const FACEPALM_DELIVERY_SCHEMA = z.object({
  readings: z.array(z.unknown()),
  missed: z.number().int().nonnegative(),
  interpretation: FACEPALM_CUE_SCHEMA.extend({ beat: FACEPALM_BEAT_KIND_SCHEMA }).optional(),
});

/** A `beat`'s parsed reply. */
export type FacepalmDelivery = z.infer<typeof FACEPALM_DELIVERY_SCHEMA>;

/** Returns whether `name` is a client name facepalm's daemon accepts: 1 to 64 of `A-Za-z0-9._-`. */
export function isFacepalmName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_FACEPALM_NAME && /^[A-Za-z0-9._-]+$/.test(name);
}

/** The `hello` line this client sends to open its connection, showing its approved token. */
export function facepalmHello(name: string, token: string): string {
  return `hello ${name} ${token}`;
}

/** The `beat` line that marks a beat and waits out its window, bounded to facepalm's limits. */
export function facepalmBeat(kind: FacepalmBeatKind, windowMs: number): string {
  const bounded = Math.min(FACEPALM_MAX_BEAT_MS, Math.max(FACEPALM_MIN_BEAT_MS, Math.round(windowMs)));
  return `beat ${kind} ${bounded}`;
}

/** The `feel` line that tells facepalm how the programmer says they felt at interpretation `id`. */
export function facepalmFeel(id: number, feeling: FacepalmFeeling): string {
  return `feel ${id} ${feeling}`;
}
