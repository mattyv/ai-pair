import { expect, it, vi } from 'vitest';
import { attachGpuWorker } from '../src/speech_gpu_worker_runtime';

const fake = vi.hoisted(() => ({
  receive: vi.fn<(value: unknown) => Promise<void>>(),
  load: undefined as ((path: string) => Promise<unknown>) | undefined,
  post: undefined as ((message: import('../src/speech_local_protocol').LocalResponse) => void) | undefined,
  close: undefined as (() => void) | undefined,
}));
vi.mock('../src/speech_gpu_worker_host', () => ({
  GpuWorkerHost: class {
    constructor(
      load: (path: string) => Promise<unknown>,
      post: (message: import('../src/speech_local_protocol').LocalResponse) => void,
      close: () => void,
    ) {
      fake.load = load;
      fake.post = post;
      fake.close = close;
    }
    receive(value: unknown): Promise<void> {
      return fake.receive(value);
    }
  },
}));

it('requires loader identity, verifies inside the child, and handles disconnect', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  const send = vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>();
  const close = vi.fn<() => void>();
  const dispose = vi.fn(() => Promise.resolve());
  const load = vi.fn(() =>
    Promise.resolve({
      engine: {
        phonemize: () => Promise.resolve('a'),
        tokenize: () => ({ dims: [1] }),
        generate: () => Promise.resolve({ samples: new Float32Array([1]), rate: 24_000 }),
      },
      dispose,
    }),
  );
  const verify = vi.fn(() => Promise.resolve(true));
  fake.receive.mockResolvedValue(undefined);
  attachGpuWorker(
    {
      on: (event, callback) => {
        handlers.set(event, callback);
      },
      send,
      close,
    },
    ['/trusted/loader', 'a'.repeat(64), '/model', '/trusted/driver', 'b'.repeat(64), '42', '99'],
    { load, verify, verifyDriver: vi.fn().mockResolvedValue(true) },
  );
  await fake.load?.('/model');
  expect(verify).toHaveBeenCalledWith('/trusted/loader', 'a'.repeat(64));
  expect(() => {
    void fake.load?.('/different');
  }).toThrow();
  fake.post?.({ type: 'failure', version: 1, category: 'load' });
  expect(send).toHaveBeenCalledOnce();
  fake.close?.();
  expect(close).toHaveBeenCalledOnce();
  handlers.get('message')?.({ type: 'init' });
  handlers.get('disconnect')?.(undefined);
  expect(fake.receive).toHaveBeenCalledWith({ type: 'shutdown', version: 1 });
});

it('rejects malformed loader identity before handling messages', () => {
  const channel = { on: vi.fn(), send: vi.fn(), close: vi.fn() };
  expect(() => {
    attachGpuWorker(channel, ['/relative', 'wrong', '/model'], { load: vi.fn(), verify: vi.fn(), verifyDriver: vi.fn() });
  }).toThrow();
  expect(channel.on).not.toHaveBeenCalled();
});

it('closes the channel if a queued message or disconnect fails', async () => {
  const handlers = new Map<string, (value: unknown) => void>();
  const close = vi.fn<() => void>();
  const channel = {
    on: (event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    },
    send: vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>(),
    close,
  };
  attachGpuWorker(channel, ['/trusted/loader', 'a'.repeat(64), '/model', '/trusted/driver', 'b'.repeat(64), '42', '99'], {
    load: vi.fn(),
    verify: vi.fn(),
    verifyDriver: vi.fn(),
  });
  fake.receive.mockRejectedValue(new Error('private'));
  handlers.get('message')?.({});
  handlers.get('disconnect')?.(undefined);
  await Promise.resolve();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(2);
});

/** Narrows the test host's captured engine without using its private state. */
function isEngine(value: unknown): value is { engine: import('../src/speech_synthesis').SpeechEngine<{ dims: number[] }> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'engine' in value &&
    typeof value.engine === 'object' &&
    value.engine !== null &&
    'generate' in value.engine &&
    typeof value.engine.generate === 'function'
  );
}

it('turns a post-synthesis loader mismatch into a fatal protocol failure', async () => {
  const send = vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>();
  const verify = vi.fn<(path: string, digest: string) => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const engine = {
    phonemize: () => Promise.resolve('a'),
    tokenize: () => ({ dims: [1] }),
    generate: () => Promise.resolve({ samples: new Float32Array([1]), rate: 24_000 }),
  };
  attachGpuWorker(
    { on: () => {}, send, close: () => {} },
    ['/trusted/loader', 'a'.repeat(64), '/model', '/trusted/driver', 'b'.repeat(64), '42', '99'],
    {
      load: () => Promise.resolve({ engine, dispose: () => Promise.resolve() }),
      verify,
      verifyDriver: vi.fn().mockResolvedValue(true),
    },
  );
  const value: unknown = await fake.load?.('/model');
  if (!isEngine(value)) throw new Error('Missing engine');
  await expect(value.engine.generate({ dims: [1] }, 'af_heart', 1)).rejects.toThrow('GPU loader verification failed.');
  fake.post?.({ type: 'failure', version: 1, epoch: 1, id: 1, part: 0, category: 'synthesis' });
  expect(send).toHaveBeenCalledWith({ type: 'failure', version: 1, epoch: 1, id: 1, part: 0, category: 'protocol' });
});

it('fails closed before emitting PCM if the mapped driver changes after initialization', async () => {
  const send = vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>();
  const verifyDriver = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const engine = {
    phonemize: () => Promise.resolve('a'),
    tokenize: () => ({ dims: [1] }),
    generate: () => Promise.resolve({ samples: new Float32Array([1]), rate: 24_000 }),
  };
  attachGpuWorker(
    { on: () => {}, send, close: () => {} },
    ['/trusted/loader', 'a'.repeat(64), '/model', '/trusted/driver', 'b'.repeat(64), '42', '99'],
    { load: () => Promise.resolve({ engine, dispose: () => Promise.resolve() }), verify: vi.fn().mockResolvedValue(true), verifyDriver },
  );
  const value: unknown = await fake.load?.('/model');
  if (!isEngine(value)) throw new Error('Missing engine');
  await expect(value.engine.generate({ dims: [1] }, 'af_heart', 1)).rejects.toThrow();
  fake.post?.({ type: 'failure', version: 1, epoch: 1, id: 1, part: 0, category: 'synthesis' });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ category: 'protocol' }));
  expect(verifyDriver).toHaveBeenCalledWith(
    { path: '/trusted/driver', sha256: 'b'.repeat(64), device: '42', inode: '99' },
    '/trusted/loader',
  );
});
