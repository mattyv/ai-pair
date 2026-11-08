import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runTempoRequest } from '../src/speech_tempo_worker_host';

const threads = vi.hoisted(() => ({ parentPort: undefined as unknown }));
vi.mock('node:worker_threads', () => ({
  get parentPort() {
    return threads.parentPort;
  },
}));
vi.mock('../src/speech_tempo_worker_host', () => ({ runTempoRequest: vi.fn() }));

/** A typed stand-in for the worker's parent port. */
interface FakePort {
  on: ReturnType<typeof vi.fn<(event: string, listener: (value: unknown) => void) => void>>;
  postMessage: ReturnType<typeof vi.fn<(value: unknown, transfer?: ArrayBuffer[]) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
}

/** Builds a fake port and loads the worker bootstrap against it. */
async function boot(): Promise<{ port: FakePort; send: (value: unknown) => void }> {
  const port: FakePort = { on: vi.fn(), postMessage: vi.fn(), close: vi.fn() };
  threads.parentPort = port;
  vi.resetModules();
  await import('../src/speech_tempo_worker');
  const listener = port.on.mock.calls[0]?.[1];
  if (listener === undefined) throw new Error('No listener registered.');
  return { port, send: listener };
}

beforeEach(() => {
  vi.mocked(runTempoRequest).mockReset();
});
afterEach(() => {
  threads.parentPort = undefined;
});

it('refuses to start without a parent port', async () => {
  // worker_threads hands the main thread a null parentPort.
  // oxlint-disable-next-line unicorn/no-null
  threads.parentPort = null;
  vi.resetModules();
  await expect(import('../src/speech_tempo_worker')).rejects.toThrow('Tempo worker requires a parent.');
});

it('posts a result and transfers its sample buffer', async () => {
  const { port, send } = await boot();
  const response = { type: 'result' as const, epoch: 1, unitId: 2, part: 0, rate: 1.5 as const, pcm: Int16Array.from([1, 2]) };
  vi.mocked(runTempoRequest).mockReturnValueOnce(response);
  send({ any: 'request' });
  expect(runTempoRequest).toHaveBeenCalledWith({ any: 'request' });
  expect(port.postMessage).toHaveBeenCalledWith(response, [response.pcm.buffer]);
});

it('posts a failure without a transfer list', async () => {
  const { port, send } = await boot();
  const response = { type: 'failed' as const, epoch: 1, unitId: 2, part: 0, rate: 0.75 as const, reason: 'failed' as const };
  vi.mocked(runTempoRequest).mockReturnValueOnce(response);
  send({});
  expect(port.postMessage).toHaveBeenCalledWith(response);
});

it('closes the port on a malformed request', async () => {
  const { port, send } = await boot();
  vi.mocked(runTempoRequest).mockReturnValueOnce(undefined);
  send('bad');
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(port.postMessage).not.toHaveBeenCalled();
});
