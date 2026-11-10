import { GpuProcessBusyError } from './speech_gpu_slot';

/** A separate, supervised proof step and its bounded result. */
export type GpuProbeResult = 'passed' | 'rejected' | 'failed' | 'timeout';

/** Proof operations; each run settles only after its child has exited. */
export interface GpuProbe {
  /** Verifies the runtime and system driver chain. */
  trust: () => Promise<boolean>;
  /** Requires one physical AMD Vulkan device in the restricted environment. */
  enumerate: () => Promise<boolean>;
  /** Runs one fresh isolated process and reaps it before settling. */
  run: (kind: 'negative' | 'tiny' | 'model') => Promise<GpuProbeResult>;
}

/** The first proof that could not be established. */
export type GpuProofFailure = 'trust' | 'enumerate' | 'negative' | 'tiny' | 'model' | 'timeout' | 'busy';

/** The outcome of checking all prerequisites. */
export type GpuProof = { phase: 'ready' } | { phase: 'unavailable'; reason: GpuProofFailure };

/** Requires every hardware and inference proof before reporting readiness. */
export async function checkGpu(probe: GpuProbe, signal?: AbortSignal): Promise<GpuProof> {
  function checkAbort(): void {
    if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
  }
  checkAbort();
  let stage: GpuProofFailure = 'trust';
  try {
    const trusted = await probe.trust();
    checkAbort();
    if (!trusted) return { phase: 'unavailable', reason: stage };
    stage = 'enumerate';
    const physical = await probe.enumerate();
    checkAbort();
    if (!physical) return { phase: 'unavailable', reason: stage };
    // specs/GpuSetup.tla, Result: each proof must succeed before the next starts.
    for (const kind of ['negative', 'tiny', 'model'] as const) {
      // specs/GpuProofAbort.tla, Spawn: cancellation prevents later stages.
      checkAbort();
      stage = kind;
      const result = await probe.run(kind);
      checkAbort();
      if (result === 'timeout') return { phase: 'unavailable', reason: 'timeout' };
      if (result !== (kind === 'negative' ? 'rejected' : 'passed')) return { phase: 'unavailable', reason: stage };
    }
    checkAbort();
    return { phase: 'ready' };
  } catch (error: unknown) {
    checkAbort();
    return { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : stage };
  }
}
