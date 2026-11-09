import type { GpuCheck, GpuCheckProgress } from './speech_compute_types';
import { GPU_MODEL_ASSET } from './speech_gpu_model_manifest';
import { GpuModelTimeoutError } from './speech_gpu_model_error';
import { GpuProcessBusyError } from './speech_gpu_client';

/** Injected operations for one explicit GPU setup. */
export interface GpuSetupFlowOptions {
  preflight: () => Promise<GpuCheck>;
  cpuModel: () => Promise<string | undefined>;
  gpuModel: () => Promise<string | undefined>;
  download: (progress: (bytes: number) => void) => Promise<string>;
  verify: (modelDirectory: string) => Promise<GpuCheck>;
  signal: AbortSignal;
  progress: (value: GpuCheckProgress) => void;
}

/** Runs preflight before downloading, then requires full GPU proof. */
export async function setupGpuFlow(options: GpuSetupFlowOptions): Promise<GpuCheck> {
  const unavailable = { phase: 'unavailable', reason: 'inconclusive' } as const;
  if (options.signal.aborted) return unavailable;
  let phase: 'preflight' | 'model' | 'verify' = 'preflight';
  try {
    // specs/GpuSetup.tla, Trust: hardware and runtime precede the optional download.
    const preflight = await options.preflight();
    if (options.signal.aborted) return unavailable;
    if (preflight.phase !== 'ready') return preflight.phase === 'unavailable' ? preflight : unavailable;
    phase = 'model';
    if ((await options.cpuModel()) === undefined) return { phase: 'unavailable', reason: 'model_missing' };
    if (options.signal.aborted) return unavailable;
    let directory = await options.gpuModel();
    if (options.signal.aborted) return unavailable;
    if (directory === undefined) {
      const total = GPU_MODEL_ASSET.size;
      let current = 0;
      let active = true;
      try {
        directory = await options.download((bytes) => {
          if (!active || options.signal.aborted || !Number.isFinite(bytes) || bytes <= 0) return;
          current = Math.min(total, current + bytes);
          options.progress({ stage: 'download', current, total });
        });
      } finally {
        active = false;
      }
    }
    if (options.signal.aborted) return unavailable;
    phase = 'verify';
    options.progress({ stage: 'check' });
    const result = await options.verify(directory);
    return options.signal.aborted ? unavailable : result.phase === 'ready' || result.phase === 'unavailable' ? result : unavailable;
  } catch (error) {
    if (options.signal.aborted) return unavailable;
    if (error instanceof GpuModelTimeoutError) return { phase: 'unavailable', reason: 'timeout' };
    if (error instanceof GpuProcessBusyError) return { phase: 'unavailable', reason: 'busy' };
    return { phase: 'unavailable', reason: phase === 'model' ? 'model_missing' : 'probe_failed' };
  }
}
