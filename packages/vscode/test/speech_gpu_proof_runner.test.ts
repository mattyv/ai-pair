import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGpuProofRunner } from '../src/speech_gpu_proof_runner';

const fake = vi.hoisted(() => ({ fork: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../src/speech_gpu_slot', () => ({ withGpuProcessSlot: (operation: () => Promise<unknown>) => operation() }));
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

it('accepts the explicit negative result only after the child closes', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  const kill = vi.fn();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill,
  });
  const pending = createGpuProofRunner(capability)('negative');
  await Promise.resolve();
  await Promise.resolve();
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  expect(settled).toBe(false);
  handlers.get('message')?.({ type: 'gpu-proof', kind: 'negative', result: 'rejected' });
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  handlers.get('close')?.(undefined);
  expect(await pending).toBe('rejected');
  expect(fake.rm).toHaveBeenCalledOnce();
  expect(fake.fork).toHaveBeenCalledOnce();
  expect(fake.fork).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Array),
    expect.objectContaining({
      env: {
        LANG: 'C',
        VK_DRIVER_FILES: '/tmp/private-proof/nonexistent-icd.json',
        VK_LOADER_LAYERS_DISABLE: '~all~',
        LD_PRELOAD: '/system/libvulkan.so',
        ELECTRON_RUN_AS_NODE: '1',
      },
    }),
  );
});

it('kills timed-out work but does not settle until reaped', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  const kill = vi.fn();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill,
  });
  const pending = createGpuProofRunner(capability)('tiny');
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  handlers.get('close')?.(0);
  expect(await pending).toBe('timeout');
});

it.each([
  ['negative', { type: 'gpu-proof', kind: 'negative', result: 'passed' }, 'failed'],
  ['tiny', { type: 'gpu-proof', kind: 'tiny', result: 'rejected' }, 'failed'],
  ['model', { type: 'gpu-proof', kind: 'model', result: 'passed' }, 'passed'],
  ['tiny', { type: 'gpu-proof', kind: 'tiny', result: 'failed' }, 'failed'],
  ['tiny', { type: 'gpu-proof', kind: 'model', result: 'passed' }, 'failed'],
  ['tiny', { type: 'gpu-proof', kind: 'tiny', result: 'passed', extra: 'private' }, 'failed'],
  ['tiny', { type: 'bad', kind: 'tiny', result: 'passed' }, 'failed'],
  ['tiny', { type: 'gpu-proof', kind: 'tiny', result: 'invalid' }, 'failed'],
  ['tiny', undefined, 'failed'],
] as const)('classifies %s proof reports safely', async (kind, message, expected) => {
  const handlers = new Map<string, (value: unknown) => void>();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill: vi.fn(),
  });
  const pending = createGpuProofRunner(capability)(kind);
  for (let index = 0; index < 5; index++) await Promise.resolve();
  if (message !== undefined) handlers.get('message')?.(message);
  handlers.get('close')?.(undefined);
  expect(await pending).toBe(expected);
});

it('fails closed on setup, spawn, or child errors and still cleans up', async () => {
  fake.mkdtemp.mockRejectedValueOnce(new Error('private'));
  expect(await createGpuProofRunner(capability)('tiny')).toBe('failed');
  fake.fork.mockImplementationOnce(() => {
    throw new Error('private');
  });
  expect(await createGpuProofRunner(capability)('tiny')).toBe('failed');
  const handlers = new Map<string, (value: unknown) => void>();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill: () => {
      throw new Error('private');
    },
  });
  fake.rm.mockRejectedValueOnce(new Error('private'));
  const pending = createGpuProofRunner(capability)('tiny');
  for (let index = 0; index < 5; index++) await Promise.resolve();
  handlers.get('error')?.(new Error('private'));
  handlers.get('message')?.({ type: 'gpu-proof', kind: 'tiny', result: 'passed' });
  handlers.get('close')?.(undefined);
  expect(await pending).toBe('failed');
});

it('rejects duplicate proof reports before close', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill: vi.fn(),
  });
  const pending = createGpuProofRunner(capability)('tiny');
  for (let index = 0; index < 5; index++) await Promise.resolve();
  const message = { type: 'gpu-proof', kind: 'tiny', result: 'passed' };
  handlers.get('message')?.(message);
  handlers.get('message')?.(message);
  handlers.get('close')?.(undefined);
  expect(await pending).toBe('failed');
});

it('SettledReaped: abort kills proof and cleans up only after close', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  const kill = vi.fn();
  fake.fork.mockReturnValue({
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    kill,
  });
  const controller = new AbortController();
  const rejected = vi.fn();
  const pending = createGpuProofRunner(capability)('model', controller.signal).catch(rejected);
  for (let index = 0; index < 5; index++) await Promise.resolve();
  controller.abort();
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  expect(rejected).not.toHaveBeenCalled();
  expect(fake.rm).not.toHaveBeenCalled();
  handlers.get('error')?.(new Error('private'));
  expect(rejected).not.toHaveBeenCalled();
  handlers.get('close')?.(undefined);
  await pending;
  expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
  expect(fake.rm).toHaveBeenCalledOnce();
});

it('NoLateSpawn: abort before setup or during temporary directory creation prevents fork', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(createGpuProofRunner(capability)('tiny', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fake.mkdtemp).not.toHaveBeenCalled();
  const later = new AbortController();
  fake.mkdtemp.mockImplementationOnce(() => {
    later.abort();
    return Promise.resolve('/tmp/private-proof');
  });
  await expect(createGpuProofRunner(capability)('tiny', later.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fake.fork).not.toHaveBeenCalled();
  expect(fake.rm).toHaveBeenCalledOnce();
});

it('handles cancellation while fork throws or returns a child', async () => {
  const throwing = new AbortController();
  fake.fork.mockImplementationOnce(() => {
    throwing.abort();
    throw new Error('fork');
  });
  await expect(createGpuProofRunner(capability)('tiny', throwing.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const controller = new AbortController();
  const handlers = new Map<string, (value: unknown) => void>();
  const kill = vi.fn();
  fake.fork.mockImplementationOnce(() => {
    controller.abort();
    return {
      on: (event: string, handler: (value: unknown) => void) => {
        handlers.set(event, handler);
      },
      kill,
    };
  });
  const pending = createGpuProofRunner(capability)('tiny', controller.signal);
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(kill).toHaveBeenCalledWith('SIGKILL');
  handlers.get('close')?.(undefined);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
