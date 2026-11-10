import { beforeEach, expect, it, vi } from 'vitest';
import { checkGpuSetup, type GpuSetupDependencies } from '../src/speech_gpu_setup';

const fake = vi.hoisted(() => ({
  check: vi.fn<(probe: import('../src/speech_gpu_check').GpuProbe) => Promise<import('../src/speech_gpu_check').GpuProof>>(),
}));
vi.mock('../src/speech_gpu_check', () => ({ checkGpu: fake.check }));

function dependencies(): GpuSetupDependencies {
  return {
    supported: true,
    inferenceAvailable: true,
    runtimeAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    modelAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    probe: { trust: vi.fn(), enumerate: vi.fn(), run: vi.fn() },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.check.mockResolvedValue({ phase: 'ready' });
});

it('requires supported runtime and model before asking for hardware proof', async () => {
  const value = dependencies();
  expect(await checkGpuSetup(value)).toEqual({ phase: 'ready' });
  expect(fake.check).toHaveBeenCalledWith(value.probe, undefined);
  value.supported = false;
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'unsupported' });
  value.supported = true;
  value.inferenceAvailable = false;
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  value.inferenceAvailable = true;
  vi.mocked(value.runtimeAvailable).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('private'));
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  vi.mocked(value.modelAvailable).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('private'));
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  expect(await checkGpuSetup(value)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
});

it.each([
  ['busy', 'busy'],
  ['trust', 'untrusted_driver'],
  ['enumerate', 'no_hardware'],
  ['negative', 'inconclusive'],
  ['tiny', 'probe_failed'],
  ['model', 'probe_failed'],
  ['timeout', 'timeout'],
] as const)('maps proof failure %s to %s', async (failure, reason) => {
  fake.check.mockResolvedValueOnce({ phase: 'unavailable', reason: failure });
  expect(await checkGpuSetup(dependencies())).toEqual({ phase: 'unavailable', reason });
});

it.each(['before', 'runtimeAvailable', 'modelAvailable', 'proof'] as const)(
  'NoAbortedCapability: abort during %s prevents successful setup',
  async (stage) => {
    const controller = new AbortController();
    const value = dependencies();
    if (stage === 'before') controller.abort();
    else if (stage === 'proof') {
      fake.check.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({ phase: 'ready' });
      });
    } else {
      vi.mocked(value[stage]).mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve(false);
      });
    }
    await expect(checkGpuSetup(value, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  },
);
