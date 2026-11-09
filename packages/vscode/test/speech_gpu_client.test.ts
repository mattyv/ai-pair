import { beforeEach, expect, it, vi } from 'vitest';
import { createGpuSynthesisClient, GpuProcessBusyError } from '../src/speech_gpu_client';
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
  const transport = { postMessage: vi.fn<(message: unknown) => void>(), on: vi.fn(), terminate: vi.fn(() => Promise.resolve()) };
  return {
    fork,
    local,
    LocalSynthesisClient,
    transport,
    acquire: vi.fn<() => (() => void) | undefined>(),
    adapter: undefined as import('../src/speech_gpu_transport').GpuChildProcess | undefined,
  };
});
vi.mock('../src/speech_gpu_slot', () => ({
  tryAcquireGpuProcessSlot: fake.acquire,
  GpuProcessBusyError: class extends Error {},
}));
vi.mock('node:child_process', () => ({ fork: fake.fork }));
vi.mock('../src/speech_local_client', () => ({ LocalSynthesisClient: fake.LocalSynthesisClient }));
vi.mock('../src/speech_gpu_transport', () => ({
  // The collaborator is constructed with `new`; the mock returns a typed fake.
  // oxlint-disable-next-line typescript/no-extraneous-class
  GpuProcessTransport: class {
    constructor(adapter: import('../src/speech_gpu_transport').GpuChildProcess) {
      fake.adapter = adapter;
      return fake.transport;
    }
  },
}));

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
  driverPath: '/verified/driver.so', driverSha256: 'b'.repeat(64), driverDevice: '42', driverInode: '99',
  environment: { LANG: 'C' as const, VK_DRIVER_FILES: '/verified/icd.json', VK_LOADER_LAYERS_DISABLE: '~all~' as const, LD_PRELOAD: '/verified/libvulkan.so' },
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.local.busy.mockReturnValue(true);
  fake.acquire.mockReturnValue(() => {});
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

it('starts only the isolated worker with an allowlisted environment', () => {
  const listeners = new Map<string, (value: unknown) => void>();
  const release = vi.fn<() => void>();
  fake.acquire.mockReturnValue(release);
  fake.fork.mockReturnValue({
    on: (event: string, callback: (value: unknown) => void) => {
      if (event === 'close' && !listeners.has('lease')) listeners.set('lease', callback);
      else listeners.set(event, callback);
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
  expect(worker).toBe(fake.transport);
  const adapter = fake.adapter;
  if (adapter === undefined) throw new Error('Missing adapter');
  const onMessage = vi.fn<(value: unknown) => void>();
  const onError = vi.fn<(value: unknown) => void>();
  const onExit = vi.fn<(value: unknown) => void>();
  adapter.on('message', onMessage);
  adapter.on('error', onError);
  adapter.on('close', onExit);
  adapter.send({ type: 'shutdown', version: 1 }, () => {});
  adapter.kill('SIGKILL');
  listeners.get('message')?.('value');
  listeners.get('error')?.(new Error('error'));
  listeners.get('lease')?.(0);
  listeners.get('close')?.(0);
  expect(release).toHaveBeenCalledOnce();
  expect(onMessage).toHaveBeenCalledWith('value');
  expect(onError).toHaveBeenCalledOnce();
  expect(onExit).toHaveBeenCalledOnce();
  expect(fake.fork).toHaveBeenCalledWith(
    '/verified/runtime/gpu_worker.mjs',
    ['/verified/libvulkan.so', 'a'.repeat(64), '/verified/model', '/verified/driver.so', 'b'.repeat(64), '42', '99'],
    expect.objectContaining({
      execPath: '/verified/node',
      serialization: 'advanced',
      execArgv: [],
      env: { LANG: 'C', VK_DRIVER_FILES: '/verified/icd.json', VK_LOADER_LAYERS_DISABLE: '~all~', LD_PRELOAD: '/verified/libvulkan.so', ELECTRON_RUN_AS_NODE: '1' },
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

it('fails with a retryable busy error when another GPU child owns the slot', () => {
  fake.acquire.mockReturnValue(undefined);
  createGpuSynthesisClient({ listener, capability });
  const options: unknown = fake.LocalSynthesisClient.mock.calls[0]?.[0];
  if (typeof options !== 'object' || options === null || !('spawn' in options) || !isSpawn(options.spawn)) throw new Error('No spawn');
  const spawn = options.spawn;
  expect(() => {
    spawn('/verified/model');
  }).toThrow(GpuProcessBusyError);
  expect(fake.fork).not.toHaveBeenCalled();
});

it('releases the reserved slot when fork fails synchronously', () => {
  const release = vi.fn<() => void>();
  fake.acquire.mockReturnValue(release);
  fake.fork.mockImplementationOnce(() => {
    throw new Error('private');
  });
  createGpuSynthesisClient({ listener, capability });
  const options: unknown = fake.LocalSynthesisClient.mock.calls[0]?.[0];
  if (typeof options !== 'object' || options === null || !('spawn' in options) || !isSpawn(options.spawn)) throw new Error('No spawn');
  const spawn = options.spawn;
  expect(() => {
    spawn('/verified/model');
  }).toThrow();
  expect(release).toHaveBeenCalledOnce();
});
