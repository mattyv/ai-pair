import { beforeEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { createGpuBinding, type GpuBindingDependencies } from '../src/speech_gpu_binding';
import { issueGpuCapability } from '../src/speech_gpu_capability';
import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import type { GpuLaunchCapability } from '../src/speech_gpu_client';

vi.mock('../src/speech_gpu_slot', () => ({ GpuProcessBusyError: class extends Error {} }));
vi.mock('../src/speech_gpu_capability', () => ({ issueGpuCapability: vi.fn() }));

const DRIVER = { manifest: '/driver', identity: { path: '/driver-library', sha256: 'b'.repeat(64), device: '1', inode: '2' } };

/** Creates isolated collaborators for the GPU host binding. */
function dependencies(): GpuBindingDependencies {
  return {
    supported: true,
    runtimeDirectory: '/runtime',
    runtimeVerified: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    model: vi.fn<() => Promise<string | undefined>>().mockResolvedValue('/model'),
    loader: vi.fn<GpuBindingDependencies['loader']>().mockResolvedValue({ path: '/loader', sha256: 'a'.repeat(64) }),
    driver: vi.fn<GpuBindingDependencies['driver']>().mockResolvedValue(DRIVER),
    physical: vi.fn<GpuBindingDependencies['physical']>().mockResolvedValue(true),
    proof: vi.fn<GpuBindingDependencies['proof']>().mockResolvedValue('passed'),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(issueGpuCapability).mockResolvedValue({ check: { phase: 'ready' } });
});

it('preflights and passes current paths and revalidation callbacks to capability issuance', async () => {
  const deps = dependencies();
  const binding = createGpuBinding(deps);
  expect(await binding.preflight()).toEqual({ phase: 'ready' });
  expect(deps.model).not.toHaveBeenCalled();
  expect(await binding.issue()).toEqual({ check: { phase: 'ready' } });
  const options = vi.mocked(issueGpuCapability).mock.calls[0]?.[0];
  if (options === undefined) throw new Error('Missing capability request');
  expect(options).toMatchObject({
    runtimeDirectory: '/runtime',
    modelDirectory: '/model',
    executablePath: '/runtime/node',
    driverManifest: '/driver',
    driverPath: '/driver-library',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
  });
  expect(await options.runtimeAvailable()).toBe(true);
  expect(await options.modelAvailable()).toBe(true);
  const capability = mock<GpuLaunchCapability>();
  const probe = options.probeFor(capability);
  expect(await probe.trust()).toBe(true);
  expect(await probe.enumerate()).toBe(true);
  expect(deps.physical).toHaveBeenCalledWith('/runtime', '/loader', DRIVER);
  expect(await probe.run('tiny')).toBe('passed');
  expect(deps.proof).toHaveBeenCalledWith(capability, 'tiny');
  vi.mocked(deps.loader).mockResolvedValueOnce(undefined);
  expect(await probe.trust()).toBe(false);
  vi.mocked(deps.driver).mockResolvedValueOnce({ ...DRIVER, identity: { ...DRIVER.identity, inode: '3' } });
  expect(await probe.trust()).toBe(false);
  for (const replacement of [
    { ...DRIVER, manifest: '/other' },
    { ...DRIVER, identity: { ...DRIVER.identity, path: '/other' } },
    { ...DRIVER, identity: { ...DRIVER.identity, sha256: 'c'.repeat(64) } },
    { ...DRIVER, identity: { ...DRIVER.identity, device: '3' } },
  ]) {
    vi.mocked(deps.driver).mockResolvedValueOnce(replacement);
    expect(await probe.trust()).toBe(false);
  }
  vi.mocked(deps.model).mockResolvedValueOnce('/other');
  expect(await options.modelAvailable()).toBe(false);
});

it('returns fixed unavailable results before issuing on each missing prerequisite', async () => {
  const deps = dependencies();
  deps.supported = false;
  expect(await createGpuBinding(deps).preflight()).toEqual({ phase: 'unavailable', reason: 'unsupported' });
  deps.supported = true;
  vi.mocked(deps.runtimeVerified).mockResolvedValueOnce(false);
  expect(await createGpuBinding(deps).preflight()).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  vi.mocked(deps.loader).mockResolvedValueOnce(undefined);
  expect((await createGpuBinding(deps).issue()).check).toEqual({ phase: 'unavailable', reason: 'untrusted_driver' });
  vi.mocked(deps.driver).mockResolvedValueOnce(undefined);
  expect((await createGpuBinding(deps).issue()).check).toEqual({ phase: 'unavailable', reason: 'untrusted_driver' });
  vi.mocked(deps.physical).mockResolvedValueOnce(false);
  expect((await createGpuBinding(deps).issue()).check).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
  vi.mocked(deps.model).mockResolvedValueOnce(undefined);
  expect((await createGpuBinding(deps).issue()).check).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  vi.mocked(deps.model).mockRejectedValueOnce(new Error('private'));
  expect((await createGpuBinding(deps).issue()).check).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  expect(issueGpuCapability).not.toHaveBeenCalled();
});

it('distinguishes a busy process from other preflight failures', async () => {
  const deps = dependencies();
  vi.mocked(deps.physical).mockRejectedValueOnce(new GpuProcessBusyError());
  expect(await createGpuBinding(deps).preflight()).toEqual({ phase: 'unavailable', reason: 'busy' });
  vi.mocked(deps.physical).mockRejectedValueOnce(new Error('private'));
  expect(await createGpuBinding(deps).preflight()).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
});
