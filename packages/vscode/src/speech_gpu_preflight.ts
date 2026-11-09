import { GpuProcessBusyError } from './speech_gpu_slot';
import type { GpuCheck, GpuUnavailableReason } from './speech_compute_types';

/** Host operations that must succeed before the optional GPU model download. */
export interface GpuPreflightDependencies {
  supported: boolean;
  runtimeAvailable: () => Promise<boolean>;
  trust: () => Promise<boolean>;
  enumerate: () => Promise<boolean>;
}

/** Checks runtime and physical hardware before downloading the GPU model. */
export async function preflightGpu(options: GpuPreflightDependencies): Promise<GpuCheck> {
  if (!options.supported) return { phase: 'unavailable', reason: 'unsupported' };
  let reason: GpuUnavailableReason = 'runtime_missing';
  try {
    if (!(await options.runtimeAvailable())) return { phase: 'unavailable', reason };
    reason = 'untrusted_driver';
    if (!(await options.trust())) return { phase: 'unavailable', reason };
    reason = 'no_hardware';
    if (!(await options.enumerate())) return { phase: 'unavailable', reason };
    return { phase: 'ready' };
  } catch (error: unknown) {
    return { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : reason };
  }
}
