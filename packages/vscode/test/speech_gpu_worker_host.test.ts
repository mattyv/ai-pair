import { expect, it, vi } from 'vitest';
import { GpuWorkerHost } from '../src/speech_gpu_worker_host';

const fake = vi.hoisted(() => ({
  receive: vi.fn<(value: unknown) => Promise<void>>(),
  load: undefined as ((path: string) => Promise<unknown>) | undefined,
}));
vi.mock('../src/speech_worker_host', () => ({
  SpeechWorkerHost: class {
    constructor(load: (path: string) => Promise<unknown>) {
      fake.load = load;
    }
    receive(value: unknown): Promise<void> {
      return fake.receive(value);
    }
  },
}));

it('waits for in-flight work, disposes the model, and closes only once', async () => {
  const gate = Promise.withResolvers<void>();
  const dispose = vi.fn(() => Promise.resolve());
  const close = vi.fn<() => void>();
  fake.receive.mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
  const host = new GpuWorkerHost(
    () =>
      Promise.resolve({
        engine: {
          phonemize: () => Promise.resolve('a'),
          tokenize: () => ({ dims: [] }),
          generate: () => Promise.resolve({ samples: new Float32Array(), rate: 24_000 }),
        },
        dispose,
      }),
    vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>(),
    close,
  );
  await fake.load?.('/verified/model');
  const work = host.receive({ type: 'init' });
  const shutdown = host.receive({ type: 'shutdown', version: 1 });
  expect(dispose).not.toHaveBeenCalled();
  gate.resolve();
  await work;
  await shutdown;
  await host.receive({ type: 'shutdown', version: 1 });
  expect(dispose).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it('closes even when model disposal fails and exposes no error text', async () => {
  fake.receive.mockResolvedValue(undefined);
  const close = vi.fn<() => void>();
  const host = new GpuWorkerHost(
    () =>
      Promise.resolve({
        engine: {
          phonemize: () => Promise.resolve('a'),
          tokenize: () => ({ dims: [] }),
          generate: () => Promise.resolve({ samples: new Float32Array(), rate: 24_000 }),
        },
        dispose: () => Promise.reject(new Error('private')),
      }),
    vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>(),
    close,
  );
  await fake.load?.('/model');
  await host.receive({ type: 'shutdown', version: 1 });
  expect(close).toHaveBeenCalledOnce();
});

it('still processes shutdown after an earlier worker message fails', async () => {
  fake.receive.mockReset();
  fake.receive.mockRejectedValueOnce(new Error('private')).mockResolvedValue(undefined);
  const close = vi.fn<() => void>();
  const host = new GpuWorkerHost(
    () => Promise.reject(new Error('unused')),
    vi.fn<(value: import('../src/speech_local_protocol').LocalResponse) => void>(),
    close,
  );
  await expect(host.receive({ type: 'init' })).rejects.toThrow();
  await host.receive({ type: 'shutdown', version: 1 });
  expect(close).toHaveBeenCalledOnce();
});
