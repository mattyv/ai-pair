import { beforeEach, expect, it, vi } from 'vitest';
import { issueGpuCapability, type GpuCapabilityInputs } from '../src/speech_gpu_capability';
import { gpuEnvironment } from '../src/speech_gpu_environment';
import { checkGpuSetup } from '../src/speech_gpu_setup';
import { GpuProcessBusyError } from '../src/speech_gpu_slot';

vi.mock('../src/speech_gpu_environment', () => ({ gpuEnvironment: vi.fn() }));
vi.mock('../src/speech_gpu_setup', () => ({ checkGpuSetup: vi.fn() }));
vi.mock('../src/speech_gpu_slot', () => ({ GpuProcessBusyError: class extends Error {} }));

/** Creates isolated inputs to the capability issuer. */
function inputs(): GpuCapabilityInputs {
  return {
    supported: true,
    runtimeAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    modelAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    inferenceAvailable: true,
    runtimeDirectory: '/runtime',
    modelDirectory: '/model',
    executablePath: '/node',
    loaderPath: '/loader',
    loaderSha256: 'a'.repeat(64),
    driverManifest: '/driver',
    driverPath: '/driver-library',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
    probeFor: vi.fn<GpuCapabilityInputs['probeFor']>().mockReturnValue({
      trust: vi.fn<() => Promise<boolean>>(),
      enumerate: vi.fn<() => Promise<boolean>>(),
      run: vi.fn(),
    }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(gpuEnvironment).mockReturnValue({
    LANG: 'C',
    VK_DRIVER_FILES: '/driver',
    VK_LOADER_LAYERS_DISABLE: '~all~',
    LD_PRELOAD: '/loader',
  });
  vi.mocked(checkGpuSetup).mockResolvedValue({ phase: 'ready' });
});

it('issues only an immutable capability whose own probe passed', async () => {
  const options = inputs();
  const result = await issueGpuCapability(options);
  expect(result.check).toEqual({ phase: 'ready' });
  expect(result.capability).toMatchObject({ runtimeDirectory: '/runtime', modelDirectory: '/model', loaderSha256: 'a'.repeat(64) });
  expect(Object.isFrozen(result.capability)).toBe(true);
  expect(Object.isFrozen(result.capability?.environment)).toBe(true);
  expect(options.probeFor).toHaveBeenCalledWith(result.capability);
  expect(gpuEnvironment).toHaveBeenCalledWith('/driver', '/loader');
  expect(checkGpuSetup).toHaveBeenCalledOnce();
});

it('does not issue on unsupported proof, malformed paths, or malformed loader hash', async () => {
  const options = inputs();
  vi.mocked(checkGpuSetup).mockResolvedValueOnce({ phase: 'unavailable', reason: 'no_hardware' });
  expect(await issueGpuCapability(options)).toEqual({ check: { phase: 'unavailable', reason: 'no_hardware' } });
  options.driverManifest = 'relative';
  expect(await issueGpuCapability(options)).toEqual({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  options.driverManifest = '/driver';
  options.loaderSha256 = 'invalid';
  expect(await issueGpuCapability(options)).toEqual({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  expect(checkGpuSetup).toHaveBeenCalledOnce();
  for (const invalid of [{ driverPath: '/a/../driver' }, { driverSha256: 'invalid' }, { driverDevice: 'bad' }, { driverInode: '-1' }]) {
    expect(await issueGpuCapability({ ...inputs(), ...invalid })).toEqual({ check: { phase: 'unavailable', reason: 'inconclusive' } });
  }
});

it('maps busy and unexpected exceptions to fixed safe results', async () => {
  const options = inputs();
  vi.mocked(options.probeFor).mockImplementationOnce(() => {
    throw new GpuProcessBusyError();
  });
  expect(await issueGpuCapability(options)).toEqual({ check: { phase: 'unavailable', reason: 'busy' } });
  vi.mocked(options.probeFor).mockImplementationOnce(() => {
    throw new Error('private');
  });
  expect(await issueGpuCapability(options)).toEqual({ check: { phase: 'unavailable', reason: 'inconclusive' } });
});

it('NoAbortedCapability: refuses to issue when aborted before or after proof', async () => {
  const before = new AbortController();
  before.abort();
  await expect(issueGpuCapability(inputs(), before.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const after = new AbortController();
  vi.mocked(checkGpuSetup).mockImplementationOnce(() => {
    after.abort();
    return Promise.resolve({ phase: 'ready' });
  });
  await expect(issueGpuCapability(inputs(), after.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
