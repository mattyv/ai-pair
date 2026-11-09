import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import { describe, expect, it, vi } from 'vitest';
import { checkGpuSetup, type GpuSetupDependencies } from '../src/speech_gpu_setup';

function dependencies(): GpuSetupDependencies {
  return {
    supported: true,
    runtimeAvailable: vi.fn().mockResolvedValue(true),
    modelAvailable: vi.fn().mockResolvedValue(true),
    inferenceAvailable: true,
    probe: {
      trust: vi.fn().mockResolvedValue(true),
      enumerate: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockImplementation((kind: string) => Promise.resolve(kind === 'negative' ? 'rejected' : 'passed')),
    },
  };
}

describe('GPU setup adapter', () => {
  it('never reports ready until runtime, model, inference and all hardware proofs pass', async () => {
    expect(await checkGpuSetup(dependencies())).toEqual({ phase: 'ready' });
    const unsupported = dependencies();
    unsupported.supported = false;
    expect(await checkGpuSetup(unsupported)).toEqual({ phase: 'unavailable', reason: 'unsupported' });
    const noRuntime = dependencies();
    vi.mocked(noRuntime.runtimeAvailable).mockResolvedValue(false);
    expect(await checkGpuSetup(noRuntime)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
    const noModel = dependencies();
    vi.mocked(noModel.modelAvailable).mockResolvedValue(false);
    expect(await checkGpuSetup(noModel)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
    const noInference = dependencies();
    noInference.inferenceAvailable = false;
    expect(await checkGpuSetup(noInference)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
  it('maps proof failures and hides exception details', async () => {
    for (const [stage, reason] of [
      ['trust', 'untrusted_driver'],
      ['enumerate', 'no_hardware'],
    ] as const) {
      const deps = dependencies();
      vi.mocked(deps.probe[stage]).mockResolvedValue(false);
      expect(await checkGpuSetup(deps)).toEqual({ phase: 'unavailable', reason });
    }
    const deps = dependencies();
    vi.mocked(deps.probe.run).mockResolvedValue('timeout');
    expect(await checkGpuSetup(deps)).toEqual({ phase: 'unavailable', reason: 'timeout' });
    vi.mocked(deps.runtimeAvailable).mockRejectedValue(new Error('private'));
    expect(await checkGpuSetup(deps)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
});

it('maps a model verification exception to a fixed reason', async () => {
  const value = dependencies();
  vi.mocked(value.modelAvailable).mockRejectedValue(new Error('private'));
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
});

it('preserves a retryable busy proof result', async () => {
  const deps = dependencies();
  vi.mocked(deps.probe.run).mockRejectedValue(new GpuProcessBusyError());
  expect(await checkGpuSetup(deps)).toEqual({ phase: 'unavailable', reason: 'busy' });
});
