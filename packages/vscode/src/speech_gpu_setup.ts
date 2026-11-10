import type { GpuCheck, GpuUnavailableReason } from './speech_compute_types';
import { checkGpu, type GpuProbe, type GpuProofFailure } from './speech_gpu_check';

/** Host-verified assets and isolated hardware proof for one GPU setup check. */
export interface GpuSetupDependencies {
  supported: boolean;
  runtimeAvailable: () => Promise<boolean>;
  modelAvailable: () => Promise<boolean>;
  inferenceAvailable: boolean;
  probe: GpuProbe;
}

const PROOF_REASONS: Record<GpuProofFailure, GpuUnavailableReason> = {
  busy: 'busy',
  trust: 'untrusted_driver',
  enumerate: 'no_hardware',
  negative: 'inconclusive',
  tiny: 'probe_failed',
  model: 'probe_failed',
  timeout: 'timeout',
};

/** Checks the isolated runtime, verified model and hardware before enabling GPU. */
export async function checkGpuSetup(options: GpuSetupDependencies, signal?: AbortSignal): Promise<GpuCheck> {
  function checkAbort(): void {
    if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
  }
  checkAbort();
  if (!options.supported) return { phase: 'unavailable', reason: 'unsupported' };
  try {
    const runtimeReady = options.inferenceAvailable && (await options.runtimeAvailable());
    checkAbort();
    if (!runtimeReady) return { phase: 'unavailable', reason: 'runtime_missing' };
  } catch {
    checkAbort();
    return { phase: 'unavailable', reason: 'runtime_missing' };
  }
  checkAbort();
  try {
    const modelReady = await options.modelAvailable();
    checkAbort();
    if (!modelReady) return { phase: 'unavailable', reason: 'model_missing' };
  } catch {
    checkAbort();
    return { phase: 'unavailable', reason: 'model_missing' };
  }
  checkAbort();
  const result = await checkGpu(options.probe, signal);
  checkAbort();
  return result.phase === 'ready' ? result : { phase: 'unavailable', reason: PROOF_REASONS[result.reason] };
}
