import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechTempoClient } from '../src/speech_tempo_client';

const fake = vi.hoisted(() => {
  class Worker {
    static made: Worker[] = [];
    static onCreate?: () => void;
    static failCreate = false;
    static failPost = false;
    listeners = new Map<string, (value?: unknown) => void>();
    closed = Promise.withResolvers<number>();
    postMessage = vi.fn(() => {
      if (Worker.failPost) throw new Error('private');
    });
    terminate = vi.fn(() => this.closed.promise);
    constructor(readonly path: string) {
      if (Worker.failCreate) throw new Error('private');
      Worker.made.push(this);
      Worker.onCreate?.();
    }
    on(type: string, listener: (value?: unknown) => void) {
      this.listeners.set(type, listener);
      return this;
    }
    emit(type: string, value?: unknown) {
      this.listeners.get(type)?.(value);
    }
  }
  return { Worker };
});
vi.mock('../src/speech_tempo_messages', () => import('./fixtures/tempo_schema_fake'));
vi.mock('node:worker_threads', () => ({ Worker: fake.Worker }));

const request = { unitId: 1, part: 0, rate: 0.75 as const, pcm: Int16Array.from([1, -1]) };
beforeEach(() => {
  fake.Worker.made.length = 0;
  fake.Worker.onCreate = undefined;
  fake.Worker.failCreate = false;
  fake.Worker.failPost = false;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('returns only a matching owned result after the worker physically retires', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const result = client.transform(request, new AbortController().signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'transform', epoch: 1, ...request }), expect.any(Array));
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 0, rate: 0.75, pcm: Int16Array.from([2]) });
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  worker.closed.resolve(0);
  expect(await result).toEqual(Int16Array.from([2]));
  await client.dispose();
});

it('rejects canceled work immediately but keeps its slot until physical retirement', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const controller = new AbortController();
  const first = client.transform(request, controller.signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  controller.abort();
  await expect(first).rejects.toThrow();
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 0, rate: 0.75, pcm: Int16Array.from([2]) });
  worker.closed.resolve(0);
  await Promise.resolve();
  await Promise.resolve();
  const next = client.transform({ ...request, unitId: 2 }, new AbortController().signal);
  const nextWorker = fake.Worker.made[1];
  if (nextWorker === undefined) throw new Error('No next worker');
  nextWorker.emit('message', { type: 'result', epoch: 2, unitId: 2, part: 0, rate: 0.75, pcm: Int16Array.from([3]) });
  nextWorker.closed.resolve(0);
  expect(await next).toEqual(Int16Array.from([3]));
  await client.dispose();
});

it('rejects a wrong-part result without exposing its contents', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const result = client.transform(request, new AbortController().signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 1, rate: 0.75, pcm: Int16Array.from([1]) });
  worker.closed.resolve(0);
  await expect(result).rejects.toThrow('Speech transform failed.');
  await client.dispose();
});

it('snapshots request identity even if the caller mutates its original object', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const input = { ...request, unitId: 1 };
  const result = client.transform(input, new AbortController().signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  input.unitId = 2;
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 0, rate: 0.75, pcm: Int16Array.from([2]) });
  worker.closed.resolve(0);
  expect(await result).toEqual(Int16Array.from([2]));
  await client.dispose();
});

it('rejects a result canceled while its worker is still retiring', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const controller = new AbortController();
  const result = client.transform(request, controller.signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 0, rate: 0.75, pcm: Int16Array.from([2]) });
  controller.abort();
  await expect(result).rejects.toThrow('Speech transform failed.');
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
  worker.closed.resolve(0);
  await client.dispose();
});

it('times out a result whose worker never retires while keeping the slot occupied', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const result = client.transform(request, new AbortController().signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  const rejected = expect(result).rejects.toThrow('Speech transform failed.');
  worker.emit('message', { type: 'result', epoch: 1, unitId: 1, part: 0, rate: 0.75, pcm: Int16Array.from([2]) });
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
  worker.closed.resolve(0);
  await client.dispose();
});

it('does not dispatch if cancellation happens during worker construction', async () => {
  const controller = new AbortController();
  fake.Worker.onCreate = () => {
    controller.abort();
  };
  const client = new SpeechTempoClient('/worker.mjs');
  const result = client.transform(request, controller.signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  await expect(result).rejects.toThrow();
  expect(worker.postMessage).not.toHaveBeenCalled();
  worker.closed.resolve(0);
  await client.dispose();
});

it('rejects invalid input, pre-aborted work, unavailable workers and disposed clients', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const aborted = new AbortController();
  aborted.abort();
  await expect(client.transform(request, aborted.signal)).rejects.toThrow();
  await expect(client.transform({ ...request, pcm: new Int16Array() }, new AbortController().signal)).rejects.toThrow();
  fake.Worker.failCreate = true;
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
  await client.dispose();
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
});

it('retires failed posts and worker errors without exposing their text', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  fake.Worker.failPost = true;
  const failedPost = client.transform(request, new AbortController().signal);
  const first = fake.Worker.made[0];
  if (first === undefined) throw new Error('No worker');
  await expect(failedPost).rejects.toThrow('Speech transform failed.');
  first.closed.resolve(0);
  await Promise.resolve();
  fake.Worker.failPost = false;
  const failedWorker = client.transform(request, new AbortController().signal);
  const second = fake.Worker.made[1];
  if (second === undefined) throw new Error('No worker');
  second.emit('error', new Error('private'));
  await expect(failedWorker).rejects.toThrow('Speech transform failed.');
  second.closed.resolve(0);
  await client.dispose();
});

it('retains the slot if termination rejects and clears it on a later actual exit', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const controller = new AbortController();
  const result = client.transform(request, controller.signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.terminate.mockRejectedValueOnce(new Error('private'));
  controller.abort();
  await expect(result).rejects.toThrow();
  await Promise.resolve();
  await expect(client.transform(request, new AbortController().signal)).rejects.toThrow();
  const disposing = client.dispose();
  worker.emit('exit', 1);
  await disposing;
  worker.emit('exit', 1);
  worker.emit('error', new Error('late'));
});

it('reports a worker exit without a result and ignores a later duplicate exit', async () => {
  const client = new SpeechTempoClient('/worker.mjs');
  const result = client.transform(request, new AbortController().signal);
  const worker = fake.Worker.made[0];
  if (worker === undefined) throw new Error('No worker');
  worker.emit('exit', 1);
  await expect(result).rejects.toThrow('Speech transform failed.');
  worker.emit('exit', 1);
  await client.dispose();
});
