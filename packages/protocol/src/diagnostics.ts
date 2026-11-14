import { z } from 'zod';
import { localSpeechDiagnostics, localSpeechReport } from './local_diagnostics';
import { gpuDiagnostics } from './gpu_diagnostics';

const MAX_PAUSE_REASONS = 5;
const MAX_EVENTS = 100;
const id = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadata = { seq: id, time: z.number().nonnegative() };
const reasons = z.array(z.enum(['programmer', 'reply', 'away', 'calibrate', 'attention'])).max(MAX_PAUSE_REASONS);
const events = z.union([
  z.strictObject({ kind: z.literal('session'), state: z.enum(['active', 'suspended', 'ended']), ...metadata }),
  z.strictObject({ kind: z.literal('connection'), state: z.enum(['connected', 'disconnected']), connectionId: id, ...metadata }),
  z.strictObject({ kind: z.literal('pause'), paused: z.boolean(), reasons, ...metadata }),
  z.strictObject({
    kind: z.literal('request'),
    connectionId: id,
    id,
    method: z.enum(['start', 'step', 'listen', 'end', 'read', 'calibrate', 'diagnostics', 'unknown']),
    phase: z.enum(['received', 'replied', 'failed', 'cancelled']),
    ...metadata,
  }),
  z.strictObject({ kind: z.literal('command'), id, phase: z.literal('requested'), waitMs: z.number().nonnegative(), ...metadata }),
  z.strictObject({ kind: z.literal('command'), id, phase: z.literal('integration'), available: z.boolean(), ...metadata }),
  z.strictObject({ kind: z.literal('command'), id, phase: z.literal('end'), exitCode: z.int().optional(), ...metadata }),
  z.strictObject({
    kind: z.literal('command'),
    id,
    phase: z.enum(['start', 'timeout', 'abort', 'closed', 'untracked', 'failed']),
    ...metadata,
  }),
  localSpeechDiagnostics.element,
]);

/** Validates read-only audio facts without identifiers, text, or credentials. */
export const AUDIO_DIAGNOSTICS_SCHEMA = z.strictObject({
  enabled: z.boolean(),
  provider: z.enum(['kokoro', 'elevenlabs', 'openrouter']),
  keyConfigured: z.union([z.boolean(), z.literal('unknown')]),
  voiceConfigured: z.boolean(),
  output: z.enum(['default', 'override', 'unknown']),
  routeAvailable: z.union([z.boolean(), z.literal('unknown')]),
  runtimeReady: z.union([z.boolean(), z.literal('unknown')]),
  modelReady: z.union([z.boolean(), z.literal('unknown')]),
  lastPlayback: z.enum(['ended', 'failed', 'unknown']),
});
/** Read-only, sanitized audio facts. */
export type AudioDiagnostics = z.infer<typeof AUDIO_DIAGNOSTICS_SCHEMA>;

/** Validates a bounded, allowlisted diagnostic snapshot without paths, keys, or text. */
export const DIAGNOSTIC_SNAPSHOT_SCHEMA = z.strictObject({
  version: z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/),
  build: z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/),
  session: z.enum(['idle', 'active', 'suspended', 'ended', 'unavailable']),
  connection: z.enum(['connected', 'disconnected', 'unavailable']),
  connectionId: z.union([id, z.literal('unavailable')]),
  paused: z.union([z.boolean(), z.literal('unavailable')]),
  pauseReasons: z.union([reasons, z.literal('unavailable')]),
  events: z.array(events).max(MAX_EVENTS),
  localSpeech: z.union([localSpeechReport, z.literal('unavailable')]).optional(),
  gpu: gpuDiagnostics.optional(),
  audio: AUDIO_DIAGNOSTICS_SCHEMA.optional(),
});
/** A validated, privacy-preserving diagnostics report. */
export type DiagnosticSnapshot = z.infer<typeof DIAGNOSTIC_SNAPSHOT_SCHEMA>;
