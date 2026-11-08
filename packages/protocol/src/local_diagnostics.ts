import { z } from 'zod';

/** Maximum locally retained speech lifecycle facts in a copied report. */
const MAX_LOCAL_SPEECH_EVENTS = 100;
const speechEvent = z.strictObject({
  kind: z.literal('speech'),
  event: z.enum(['preview', 'catalog', 'setup', 'capability', 'runtime']),
  phase: z.enum(['received', 'blocked', 'dispatched', 'ready', 'failed']),
  provider: z.enum(['kokoro', 'elevenlabs', 'unknown']),
  reason: z
    .enum([
      'unsupported',
      'host_platform',
      'host_arch',
      'libc_unknown',
      'libc_report_failed',
      'no_key',
      'no_voice',
      'not_ready',
      'auth',
      'rate',
      'network',
      'timeout',
      'invalid',
      'canceled',
      'unknown',
      'runtime_missing',
      'model_missing',
      'worker_module',
      'worker_native',
      'worker_permission',
      'worker_error',
      'worker_exit',
      'model_load',
      'synthesis',
      'audio_page',
    ])
    .optional(),
  seq: z.int().nonnegative(),
  time: z.number().nonnegative(),
});

/** Validates bounded sanitized speech lifecycle facts. */
export const localSpeechDiagnostics = z.array(speechEvent).max(MAX_LOCAL_SPEECH_EVENTS);

/** Validates local companion build identity and sanitized speech diagnostics. */
export const localSpeechReport = z.strictObject({
  version: z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/),
  build: z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/),
  events: localSpeechDiagnostics,
});

/** A validated local companion diagnostic report. */
export type LocalSpeechReport = z.infer<typeof localSpeechReport>;
