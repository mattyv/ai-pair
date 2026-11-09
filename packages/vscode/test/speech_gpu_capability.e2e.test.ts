import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import { expect, it, vi } from 'vitest';
import { issueGpuCapability, type GpuCapabilityInputs } from '../src/speech_gpu_capability';

function inputs(): GpuCapabilityInputs {
  return {
    supported: true,
    runtimeAvailable: vi.fn().mockResolvedValue(true),
    modelAvailable: vi.fn().mockResolvedValue(true),
    inferenceAvailable: true,
    runtimeDirectory: '/runtime',
    modelDirectory: '/model',
    executablePath: '/node',
    loaderPath: '/lib/libvulkan.so.1',
    loaderSha256: 'a'.repeat(64),
    driverManifest: '/driver.json',
    driverPath: '/driver-library',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
    probeFor: vi.fn().mockReturnValue({
      trust: vi.fn().mockResolvedValue(true),
      enumerate: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockImplementation((kind: string) => Promise.resolve(kind === 'negative' ? 'rejected' : 'passed')),
    }),
  };
}
it('issues a fresh isolated capability only after all current proofs pass', async () => {
  const options = inputs();
  const result = await issueGpuCapability(options);
  expect(options.probeFor).toHaveBeenCalledWith(result.capability);
  expect(result.check).toEqual({ phase: 'ready' });
  expect(result.capability).toMatchObject({
    runtimeDirectory: '/runtime',
    modelDirectory: '/model',
    loaderSha256: 'a'.repeat(64),
    environment: { LANG: 'C', VK_DRIVER_FILES: '/driver.json', VK_LOADER_LAYERS_DISABLE: '~all~' },
  });
});
it('never issues a capability on missing runtime, failed proof or malformed identity', async () => {
  const missing = inputs();
  missing.inferenceAvailable = false;
  expect((await issueGpuCapability(missing)).capability).toBeUndefined();
  const failed = inputs();
  vi.mocked(failed.probeFor).mockReturnValue({
    trust: vi.fn().mockResolvedValue(true),
    enumerate: vi.fn().mockResolvedValue(false),
    run: vi.fn(),
  });
  expect((await issueGpuCapability(failed)).capability).toBeUndefined();
  const malformed = inputs();
  malformed.driverManifest = 'relative';
  expect((await issueGpuCapability(malformed)).capability).toBeUndefined();
});

it('does not issue when the proof factory throws', async () => {
  const value = inputs();
  vi.mocked(value.probeFor).mockImplementation(() => {
    throw new Error('private');
  });
  expect(await issueGpuCapability(value)).toEqual({ check: { phase: 'unavailable', reason: 'inconclusive' } });
});

it('preserves retryable busy if proof construction cannot acquire the slot', async () => {
  const value = inputs();
  vi.mocked(value.probeFor).mockImplementation(() => {
    throw new GpuProcessBusyError();
  });
  expect(await issueGpuCapability(value)).toEqual({ check: { phase: 'unavailable', reason: 'busy' } });
});
