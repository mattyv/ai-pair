import { afterEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const reply: { current?: (message: unknown) => void } = {};
  return {
    on: vi.fn<(event: string, callback: (message: unknown) => void) => void>(),
    postMessage: vi.fn(),
    receive: vi.fn(),
    reply,
  };
});
vi.mock('node:worker_threads', () => ({ parentPort: { on: fake.on, postMessage: fake.postMessage } }));
vi.mock('../src/speech_engine', () => ({ loadSpeechEngine: vi.fn() }));
vi.mock('../src/speech_worker_host', () => ({
  SpeechWorkerHost: class {
    receive = fake.receive;
    constructor(load: unknown, reply: (message: unknown) => void) {
      void load;
      fake.reply.current = reply;
    }
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:worker_threads');
});

it('connects worker messages and replies to the validated host', async () => {
  await import('../src/speech_worker');
  expect(fake.on).toHaveBeenCalledWith('message', expect.any(Function));
  const handler = fake.on.mock.calls[0]?.[1];
  if (handler === undefined || fake.reply.current === undefined) throw new Error('No worker handler');
  handler({ type: 'load', modelPath: '/model' });
  expect(fake.receive).toHaveBeenCalledWith({ type: 'load', modelPath: '/model' });
  fake.reply.current({ type: 'ready' });
  expect(fake.postMessage).toHaveBeenCalledWith({ type: 'ready' });
});

it('refuses to run the worker entry outside a worker thread', async () => {
  const parentPort: unknown = JSON.parse('null');
  vi.doMock('node:worker_threads', () => ({ parentPort }));
  await expect(import('../src/speech_worker')).rejects.toThrow('parent port');
});
