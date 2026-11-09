import { beforeEach, expect, it, vi } from 'vitest';
import { createGpuSynthesisClient } from '../src/speech_gpu_client';
import type { WorkerLike } from '../src/speech_local_client';

const fake = vi.hoisted(() => {
  const fork = vi.fn();
  const local = { state: vi.fn(), busy: vi.fn(), load: vi.fn(), synthesize: vi.fn(), cancel: vi.fn(), retire: vi.fn() };
  // The fake must be constructible because the production client uses `new`.
  // oxlint-disable-next-line eslint/prefer-arrow-callback
  const LocalSynthesisClient = vi.fn(function (options: unknown) {
    void options;
    return local;
  });
  return { fork, local, LocalSynthesisClient };
});
vi.mock('node:child_process', () => ({ fork: fake.fork }));
vi.mock('../src/speech_local_client', () => ({ LocalSynthesisClient: fake.LocalSynthesisClient }));

const listener = { ready: vi.fn<() => void>(), retired: vi.fn<(reason: string) => void>() };

function isSpawn(value: unknown): value is (modelPath: string) => WorkerLike {
  return typeof value === 'function';
}
const capability = {
  runtimeDirectory: '/verified/runtime',
  modelDirectory: '/verified/model',
  executablePath: '/verified/node',
  loaderPath: '/verified/libvulkan.so',
  loaderSha256: 'a'.repeat(64),
  environment: { LANG: 'C' as const, VK_DRIVER_FILES: '/verified/icd.json', VK_LOADER_LAYERS_DISABLE: '~all~' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.local.busy.mockReturnValue(true);
});

it('requires the verified model and holds retirement after cancel', () => {
  const client = createGpuSynthesisClient({ listener, capability });
  expect(() => {
    client.load('/other/model');
  }).toThrow();
  client.load('/verified/model');
  expect(fake.local.load).toHaveBeenCalledWith('/verified/model');
  client.cancel();
  expect(fake.local.cancel).toHaveBeenCalledOnce();
  expect(fake.local.retire).toHaveBeenCalledWith('worker_exit');
});

it('starts only the isolated worker with an allowlisted environment', async () => {
  vi.useFakeTimers();
  const listeners = new Map<string, (value: unknown) => void>();
  fake.fork.mockReturnValue({
    on: (event: string, callback: (value: unknown) => void) => {
      listeners.set(event, callback);
    },
    send: vi.fn(),
    kill: vi.fn(),
  });
  createGpuSynthesisClient({ listener, capability });
  const options: unknown = fake.LocalSynthesisClient.mock.calls[0]?.[0];
  if (typeof options !== 'object' || options === null || !('spawn' in options) || !isSpawn(options.spawn)) {
    throw new Error('No spawn');
  }
  const spawn = options.spawn;
  expect(() => {
    spawn('/wrong');
  }).toThrow();
  const worker = spawn('/verified/model');
  const onMessage = vi.fn<(value: unknown) => void>();
  const onError = vi.fn<(value: unknown) => void>();
  const onExit = vi.fn<(value: unknown) => void>();
  worker.on('message', onMessage);
  worker.on('error', onError);
  worker.on('exit', onExit);
  worker.postMessage({ type: 'shutdown', version: 1 });
  listeners.get('message')?.('value');
  listeners.get('error')?.(new Error('error'));
  const terminated = worker.terminate();
  await vi.advanceTimersByTimeAsync(2000);
  listeners.get('close')?.(0);
  await terminated;
  vi.useRealTimers();
  expect(onMessage).toHaveBeenCalledWith('value');
  expect(onError).toHaveBeenCalledOnce();
  expect(onExit).toHaveBeenCalledOnce();
  expect(fake.fork).toHaveBeenCalledWith(
    '/verified/runtime/gpu_worker.mjs',
    ['/verified/libvulkan.so', 'a'.repeat(64), '/verified/model'],
    expect.objectContaining({
      execPath: '/verified/node',
      serialization: 'advanced',
      execArgv: [],
      env: { LANG: 'C', VK_DRIVER_FILES: '/verified/icd.json', VK_LOADER_LAYERS_DISABLE: '~all~', ELECTRON_RUN_AS_NODE: '1' },
    }),
  );
});

it('retires a worker canceled while loading, but keeps an idle warm worker', () => {
  const client = createGpuSynthesisClient({ listener, capability });
  fake.local.busy.mockReturnValue(false);
  fake.local.state.mockReturnValue('loading');
  client.cancel();
  expect(fake.local.retire).toHaveBeenCalledWith('worker_exit');
  vi.mocked(fake.local.retire).mockClear();
  fake.local.state.mockReturnValue('ready');
  client.cancel();
  expect(fake.local.retire).not.toHaveBeenCalled();
});

it('rejects invalid capabilities and forwards the local interface', () => {
  expect(() => {
    createGpuSynthesisClient({ listener, capability: { ...capability, loaderPath: 'relative' } });
  }).toThrow();
  expect(() => {
    createGpuSynthesisClient({ listener, capability: { ...capability, loaderSha256: 'bad' } });
  }).toThrow();
  const client = createGpuSynthesisClient({ listener, capability });
  client.state();
  client.busy();
  void client.synthesize({ id: 1, part: 0, final: true, text: 'safe', voice: 'af_heart', speed: 1 });
  client.retire('timeout');
  expect(fake.local.state).toHaveBeenCalled();
  expect(fake.local.synthesize).toHaveBeenCalledOnce();
  expect(fake.local.retire).toHaveBeenCalledWith('timeout');
});
