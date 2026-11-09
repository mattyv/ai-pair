import { z } from 'zod';

export const MAX_GPU_WORKER_DETAILS = 8;

/** Fixed, private companion facts; no raw errors, paths or speech content. */
export const gpuDiagnostics = z.strictObject({
  requestedMode: z.enum(['cpu', 'auto', 'gpu']),
  actualBackend: z.enum(['none', 'cpu', 'gpu']),
  check: z.discriminatedUnion('phase', [
    z.strictObject({ phase: z.literal('idle') }),
    z.strictObject({ phase: z.literal('checking') }),
    z.strictObject({ phase: z.literal('ready') }),
    z.strictObject({
      phase: z.literal('unavailable'),
      reason: z.enum([
        'busy',
        'unsupported',
        'runtime_missing',
        'untrusted_driver',
        'no_hardware',
        'inconclusive',
        'model_missing',
        'probe_failed',
        'timeout',
      ]),
    }),
  ]),
  stage: z.enum(['idle', 'preflight', 'model', 'verify', 'admission']),
  workerDetails: z
    .array(
      z.enum([
        'loading',
        'ready',
        'synthesizing',
        'spawn_error',
        'ipc_error',
        'exit_zero',
        'exit_nonzero',
        'signal_segv',
        'signal_abort',
        'signal_kill',
        'signal_other',
      ]),
    )
    .max(MAX_GPU_WORKER_DETAILS)
    .optional(),
});
export type GpuDiagnostics = z.infer<typeof gpuDiagnostics>;
