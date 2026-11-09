import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GpuProcessTransport, type GpuChildProcess } from '../src/speech_gpu_transport';

/** A controllable process whose close event represents actual OS retirement. */
function child() {
  const handlers = new Map<string, (value: unknown) => void>();
  const send = vi.fn<GpuChildProcess['send']>();
  const kill = vi.fn<GpuChildProcess['kill']>();
  kill.mockReturnValue(true);
  const process: GpuChildProcess = {
    send,
    kill,
    on: (event, callback) => {
      handlers.set(event, callback);
    },
  };
  return { process, handlers, send, kill };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('forwards messages and waits for close before resolving termination', async () => {
  const fake = child();
  const transport = new GpuProcessTransport(fake.process);
  const received = vi.fn<(value: unknown) => void>();
  const exit = vi.fn<(value: unknown) => void>();
  transport.on('message', received);
  transport.on('exit', exit);
  transport.postMessage({ type: 'init' });
  expect(fake.send).toHaveBeenCalledWith({ type: 'init' }, expect.any(Function));
  fake.handlers.get('message')?.({ safe: true });
  expect(received).toHaveBeenCalledWith({ safe: true });
  let settled = false;
  const termination = transport.terminate().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
  expect(settled).toBe(false);
  fake.handlers.get('close')?.(0);
  await termination;
  expect(exit).toHaveBeenCalledTimes(1);
});

it('reports send errors and clears the kill timer after graceful close', async () => {
  const fake = child();
  const transport = new GpuProcessTransport(fake.process);
  const errors = vi.fn<(value: unknown) => void>();
  transport.on('error', errors);
  transport.postMessage({ type: 'shutdown' });
  const callback = vi.mocked(fake.send).mock.calls[0]?.[1];
  // Node's IPC callback uses null to indicate success.
  // oxlint-disable-next-line unicorn/no-null
  callback?.(null);
  callback?.(new Error('private'));
  expect(errors).toHaveBeenCalledWith(expect.any(Error));
  const termination = transport.terminate();
  fake.handlers.get('close')?.(0);
  await termination;
  await vi.advanceTimersByTimeAsync(2000);
  expect(fake.kill).not.toHaveBeenCalled();
});

it('forwards process errors, ignores duplicate close and refuses sends after close', async () => {
  const fake = child();
  const transport = new GpuProcessTransport(fake.process);
  const errors = vi.fn<(value: unknown) => void>();
  const exit = vi.fn<(value: unknown) => void>();
  transport.on('error', errors);
  transport.on('exit', exit);
  fake.handlers.get('error')?.(new Error('unavailable'));
  fake.handlers.get('close')?.(0);
  fake.handlers.get('close')?.(0);
  await transport.terminate();
  expect(errors).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledOnce();
  expect(() => {
    transport.postMessage({});
  }).toThrow();
});

it('retains ownership when a kill request throws until close', async () => {
  const fake = child();
  fake.kill.mockImplementation(() => {
    throw new Error('private');
  });
  const transport = new GpuProcessTransport(fake.process);
  const first = transport.terminate();
  const second = transport.terminate();
  expect(first).toBe(second);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fake.kill).toHaveBeenCalledOnce();
  fake.handlers.get('close')?.(0);
  await first;
});
