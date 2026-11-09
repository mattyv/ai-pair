import { expect, it, vi } from 'vitest';
import { gpuPhysicalDevice } from '../src/speech_gpu_physical';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), supervise: vi.fn(), slot: vi.fn((operation: () => Promise<unknown>) => operation()) }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../src/speech_gpu_proof_runner', () => ({ withGpuProcessSlot: mocks.slot }));
const driver = {
  manifest: '/system/radeon.json',
  identity: { path: '/system/libvulkan_radeon.so', sha256: 'a'.repeat(64), device: '2049', inode: '42' },
};
vi.mock('../src/speech_gpu_process', () => ({ runGpuProcess: mocks.supervise }));

it('runs the native device probe with only the selected loader and isolated driver environment', async () => {
  mocks.supervise.mockImplementation((start: () => unknown) => {
    start();
    return Promise.resolve('passed');
  });
  mocks.spawn.mockReturnValue({ on: vi.fn(), kill: vi.fn() });
  expect(await gpuPhysicalDevice('/runtime', '/system/libvulkan.so', driver)).toBe(true);
  expect(mocks.slot).toHaveBeenCalled();
  expect(mocks.spawn).toHaveBeenCalledWith('/runtime/gpu_probe', ['/system/libvulkan.so', '/system/libvulkan_radeon.so', '2049', '42'], {
    env: { LANG: 'C', VK_DRIVER_FILES: '/system/radeon.json', VK_LOADER_LAYERS_DISABLE: '~all~', LD_PRELOAD: '/system/libvulkan.so' },
    stdio: 'ignore',
  });
});
it('treats probe failures and timeouts as unavailable', async () => {
  for (const result of ['failed', 'timeout'] as const) {
    mocks.supervise.mockResolvedValue(result);
    expect(await gpuPhysicalDevice('/runtime', '/loader', driver)).toBe(false);
  }
});

it('forwards child close, error and SIGKILL to the supervisor', async () => {
  const on = vi.fn();
  const kill = vi.fn().mockReturnValue(true);
  mocks.spawn.mockReturnValue({ on, kill });
  mocks.supervise.mockImplementation(
    (
      start: () => { on: (event: 'close' | 'error', listener: (value?: unknown) => void) => void; kill: (signal: 'SIGKILL') => boolean },
    ) => {
      const child = start();
      const listener = vi.fn<(value?: unknown) => void>();
      child.on('close', listener);
      child.on('error', listener);
      child.kill('SIGKILL');
      return Promise.resolve('passed');
    },
  );
  expect(await gpuPhysicalDevice('/runtime', '/loader', driver)).toBe(true);
  expect(on).toHaveBeenCalledTimes(2);
  expect(kill).toHaveBeenCalledWith('SIGKILL');
});
