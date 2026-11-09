import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import { expect, it, vi } from 'vitest';
import { createGpuBinding, type GpuBindingDependencies } from '../src/speech_gpu_binding';

function dependencies(): GpuBindingDependencies {
  return {
    supported: true,
    runtimeDirectory: '/runtime',
    runtimeVerified: vi.fn().mockResolvedValue(true),
    model: vi.fn().mockResolvedValue('/model'),
    loader: vi.fn().mockResolvedValue({ path: '/lib/libvulkan.so.1', sha256: 'a'.repeat(64) }),
    driver: vi
      .fn()
      .mockResolvedValue({ manifest: '/driver.json', identity: { path: '/driver.so', sha256: 'b'.repeat(64), device: '1', inode: '2' } }),
    physical: vi.fn().mockResolvedValue(true),
    proof: vi.fn().mockImplementation((cap, kind: string) => {
      void cap;
      return Promise.resolve(kind === 'negative' ? 'rejected' : 'passed');
    }),
  };
}
it('performs hardware preflight before model work and issues only after fresh complete proof', async () => {
  const deps = dependencies();
  const binding = createGpuBinding(deps);
  expect(await binding.preflight()).toEqual({ phase: 'ready' });
  expect(deps.model).not.toHaveBeenCalled();
  const result = await binding.issue();
  expect(result.check).toEqual({ phase: 'ready' });
  expect(result.capability).toMatchObject({
    runtimeDirectory: '/runtime',
    modelDirectory: '/model',
    executablePath: '/runtime/node',
    loaderPath: '/lib/libvulkan.so.1',
  });
  expect(deps.proof).toHaveBeenCalledTimes(3);
});
it('does not issue on missing assets, no physical device or failed proof', async () => {
  const missing = dependencies();
  vi.mocked(missing.runtimeVerified).mockResolvedValue(false);
  expect((await createGpuBinding(missing).preflight()).phase).toBe('unavailable');
  expect(missing.model).not.toHaveBeenCalled();
  const physical = dependencies();
  vi.mocked(physical.physical).mockResolvedValue(false);
  expect((await createGpuBinding(physical).issue()).capability).toBeUndefined();
  expect(physical.proof).not.toHaveBeenCalled();
  const failed = dependencies();
  vi.mocked(failed.proof).mockResolvedValue('failed');
  expect((await createGpuBinding(failed).issue()).capability).toBeUndefined();
});

it('does not propagate model verification errors or stale loader identity', async () => {
  const broken = dependencies();
  vi.mocked(broken.model).mockRejectedValue(new Error('private'));
  expect(await createGpuBinding(broken).issue()).toEqual({ check: { phase: 'unavailable', reason: 'model_missing' } });
  const stale = dependencies();
  vi.mocked(stale.loader)
    .mockResolvedValueOnce({ path: '/lib/libvulkan.so.1', sha256: 'a'.repeat(64) })
    .mockResolvedValueOnce(undefined);
  expect((await createGpuBinding(stale).issue()).capability).toBeUndefined();
});

it('maps a runtime preflight exception to an unavailable result', async () => {
  const value = dependencies();
  vi.mocked(value.runtimeVerified).mockRejectedValue(new Error('private'));
  expect(await createGpuBinding(value).preflight()).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
});

it('rejects unsupported hosts, missing trusted identity and missing model', async () => {
  const unsupported = dependencies();
  unsupported.supported = false;
  expect((await createGpuBinding(unsupported).preflight()).phase).toBe('unavailable');
  const noLoader = dependencies();
  vi.mocked(noLoader.loader).mockResolvedValue(undefined);
  expect((await createGpuBinding(noLoader).issue()).capability).toBeUndefined();
  const noDriver = dependencies();
  vi.mocked(noDriver.driver).mockResolvedValue(undefined);
  expect((await createGpuBinding(noDriver).issue()).capability).toBeUndefined();
  const noModel = dependencies();
  vi.mocked(noModel.model).mockResolvedValue(undefined);
  expect(await createGpuBinding(noModel).issue()).toEqual({ check: { phase: 'unavailable', reason: 'model_missing' } });
});

it('reports retryable busy when a prior child owns the physical proof slot', async () => {
  const deps = dependencies();
  vi.mocked(deps.physical).mockRejectedValue(new GpuProcessBusyError());
  expect(await createGpuBinding(deps).preflight()).toEqual({ phase: 'unavailable', reason: 'busy' });
  expect(await createGpuBinding(deps).issue()).toEqual({ check: { phase: 'unavailable', reason: 'busy' } });
});
