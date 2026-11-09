import { expect, it, vi } from 'vitest';
import { createGpuHostBinding } from '../src/speech_gpu_host_binding';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  assets: vi.fn(),
  verify: vi.fn(),
  model: vi.fn(),
  loader: vi.fn(),
  driver: vi.fn(),
  physical: vi.fn(),
}));
vi.mock('../src/speech_gpu_binding', () => ({ createGpuBinding: mocks.create }));
vi.mock('../src/speech_gpu_bundled_assets', () => ({ bundledGpuAssets: mocks.assets }));
vi.mock('../src/speech_gpu_assets', () => ({ verifyGpuAssets: mocks.verify }));
vi.mock('../src/speech_gpu_asset_fs', () => ({ gpuAssetFilesystem: {} }));
vi.mock('../src/speech_gpu_model', () => ({ installedGpuModel: mocks.model }));
vi.mock('../src/speech_gpu_system', () => ({ systemGpuLoader: mocks.loader, systemGpuDriver: mocks.driver }));
vi.mock('../src/speech_gpu_physical', () => ({ gpuPhysicalDevice: mocks.physical }));

it('binds the companion runtime, embedded hashes, model and real host checks', () => {
  mocks.create.mockImplementation((deps: { runtimeVerified: () => Promise<boolean>; model: () => Promise<unknown> }) => {
    void deps.runtimeVerified();
    void deps.model();
    return { preflight: vi.fn(), issue: vi.fn() };
  });
  mocks.assets.mockReturnValue([{ path: 'node', size: 1, sha256: 'a'.repeat(64) }]);
  mocks.verify.mockResolvedValue(true);
  mocks.model.mockResolvedValue('/model');
  const proof = vi.fn();
  createGpuHostBinding({ extensionPath: '/extension', storageDirectory: '/storage', proof, platform: 'linux', arch: 'x64' });
  expect(mocks.verify).toHaveBeenCalledWith('/extension/dist/speech-gpu', expect.any(Array), expect.any(Object));
  expect(mocks.model).toHaveBeenCalledWith('/storage');
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ supported: true, runtimeDirectory: '/extension/dist/speech-gpu', proof }),
  );
});
