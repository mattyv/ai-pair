import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGpuProofRunner } from '../src/speech_gpu_proof_runner';
import { GpuProcessBusyError } from '../src/speech_gpu_slot';

const fake = vi.hoisted(() => ({ fork: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: fake.fork }));
vi.mock('node:fs/promises', () => ({ mkdtemp: fake.mkdtemp, rm: fake.rm }));
const capability = {
  runtimeDirectory: '/runtime',
  modelDirectory: '/model',
  executablePath: '/runtime/node',
  loaderPath: '/system/libvulkan.so',
  loaderSha256: 'a'.repeat(64),
  driverPath: '/driver/lib.so',
  driverSha256: 'b'.repeat(64),
  driverDevice: '42',
  driverInode: '99',
  environment: {
    LANG: 'C' as const,
    VK_DRIVER_FILES: '/driver/icd.json',
    VK_LOADER_LAYERS_DISABLE: '~all~' as const,
    LD_PRELOAD: '/system/libvulkan.so',
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.mkdtemp.mockResolvedValue('/tmp/private-proof');
  fake.rm.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

it('rejects replacement proof work until the previous child closes', async () => {
  const children: Array<Map<string, (value: unknown) => void>> = [];
  fake.fork.mockImplementation(() => {
    const handlers = new Map<string, (value: unknown) => void>();
    children.push(handlers);
    return {
      on: (event: string, handler: (value: unknown) => void) => {
        handlers.set(event, handler);
      },
      kill: vi.fn(),
    };
  });
  const first = createGpuProofRunner(capability)('tiny');
  const second = createGpuProofRunner(capability)('model');
  await expect(second).rejects.toBeInstanceOf(GpuProcessBusyError);
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(children).toHaveLength(1);
  children[0]?.get('message')?.({ type: 'gpu-proof', kind: 'tiny', result: 'passed' });
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(children).toHaveLength(1);
  children[0]?.get('close')?.(undefined);
  expect(await first).toBe('passed');
  const retry = createGpuProofRunner(capability)('model');
  for (let index = 0; index < 10; index++) await Promise.resolve();
  expect(children).toHaveLength(2);
  children[1]?.get('message')?.({ type: 'gpu-proof', kind: 'model', result: 'passed' });
  children[1]?.get('close')?.(undefined);
  expect(await retry).toBe('passed');
});
