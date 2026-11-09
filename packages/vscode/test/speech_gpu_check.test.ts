import { describe, expect, it, vi } from 'vitest';
import { checkGpu, type GpuProbe } from '../src/speech_gpu_check';

/** Makes a fully verified probe whose collaborators may be replaced per case. */
function probe(): GpuProbe {
  return {
    trust: vi.fn().mockResolvedValue(true),
    enumerate: vi.fn().mockResolvedValue(true),
    run: vi.fn().mockImplementation((kind: string) => Promise.resolve(kind === 'negative' ? 'rejected' : 'passed')),
  };
}

describe('GPU setup proof', () => {
  it('GpuVerified: requires trust, physical device, negative control, tiny graph and model', async () => {
    const runner = probe();
    expect(await checkGpu(runner)).toEqual({ phase: 'ready' });
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(vi.mocked(runner.run).mock.calls.map(([kind]) => kind)).toEqual(['negative', 'tiny', 'model']);
  });

  it('GpuVerified: fails closed at each failed proof', async () => {
    for (const stage of ['trust', 'enumerate', 'negative', 'tiny', 'model'] as const) {
      const runner = probe();
      if (stage === 'trust' || stage === 'enumerate') vi.mocked(runner[stage]).mockResolvedValue(false);
      else
        vi.mocked(runner.run).mockImplementation((kind) =>
          Promise.resolve(kind === stage ? 'failed' : kind === 'negative' ? 'rejected' : 'passed'),
        );
      expect(await checkGpu(runner)).toEqual({ phase: 'unavailable', reason: stage });
    }
  });

  it('GpuVerified: treats a timeout or a successful invalid control as inconclusive', async () => {
    for (const outcome of ['passed', 'timeout'] as const) {
      const runner = probe();
      vi.mocked(runner.run).mockResolvedValue(outcome);
      expect(await checkGpu(runner)).toEqual({ phase: 'unavailable', reason: outcome === 'timeout' ? 'timeout' : 'negative' });
      expect(runner.run).toHaveBeenCalledTimes(1);
    }
  });

  it('GpuVerified: does not expose exceptions from a probe', async () => {
    const runner = probe();
    vi.mocked(runner.trust).mockRejectedValue(new Error('private driver path'));
    expect(await checkGpu(runner)).toEqual({ phase: 'unavailable', reason: 'trust' });
  });
});
