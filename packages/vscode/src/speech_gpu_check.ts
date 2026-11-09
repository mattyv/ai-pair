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
export type GpuProofFailure = 'trust' | 'enumerate' | 'negative' | 'tiny' | 'model' | 'timeout';

/** The outcome of checking all prerequisites. */
export type GpuProof = { phase: 'ready' } | { phase: 'unavailable'; reason: GpuProofFailure };

/** Requires every hardware and inference proof before reporting readiness. */
export async function checkGpu(probe: GpuProbe): Promise<GpuProof> {
  let stage: GpuProofFailure = 'trust';
  try {
    if (!(await probe.trust())) return { phase: 'unavailable', reason: stage };
    stage = 'enumerate';
    if (!(await probe.enumerate())) return { phase: 'unavailable', reason: stage };
    // specs/GpuSetup.tla, Result: each proof must succeed before the next starts.
    for (const kind of ['negative', 'tiny', 'model'] as const) {
      stage = kind;
      const result = await probe.run(kind);
      if (result === 'timeout') return { phase: 'unavailable', reason: 'timeout' };
      if (result !== (kind === 'negative' ? 'rejected' : 'passed')) return { phase: 'unavailable', reason: stage };
    }
    return { phase: 'ready' };
  } catch {
    return { phase: 'unavailable', reason: stage };
  }
}
