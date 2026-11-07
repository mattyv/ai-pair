import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandChannel } from '../src/command_channel';

afterEach(() => {
  vi.useRealTimers();
});

describe('ordered command channel', () => {
  it('sends one frame at a time and preserves enqueue order', async () => {
    const first = Promise.withResolvers<void>();
    const send = vi.fn<(frame: number) => Promise<void>>().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const channel = new CommandChannel({ send, timeoutMs: 100, maxPending: 3, lost: vi.fn<() => void>() });
    const one = channel.send(1);
    const two = channel.send(2);
    expect(send.mock.calls).toEqual([[1]]);
    first.resolve();
    expect(await one).toBe(true);
    expect(await two).toBe(true);
    expect(send.mock.calls).toEqual([[1], [2]]);
  });

  it('closes on timeout or overflow and settles all queued callers', async () => {
    vi.useFakeTimers();
    const send = vi.fn<(_: number) => Promise<void>>(() => new Promise(() => {}));
    const lost = vi.fn<() => void>();
    const channel = new CommandChannel({ send, timeoutMs: 100, maxPending: 2, lost });
    const first = channel.send(1);
    const second = channel.send(2);
    const third = channel.send(3);
    expect(await third).toBe(false);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(await channel.send(4)).toBe(false);
  });

  it('closes on a lost acknowledgement without accepting late completion', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<void>();
    const lost = vi.fn<() => void>();
    const channel = new CommandChannel({ send: () => pending.promise, timeoutMs: 100, maxPending: 2, lost });
    const sent = channel.send(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(await sent).toBe(false);
    pending.resolve();
    await Promise.resolve();
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

it('closes on synchronous and asynchronous send failure', async () => {
  const lost = vi.fn<() => void>();
  const first = new CommandChannel<number>({
    send: () => {
      throw new Error('private');
    },
    timeoutMs: 100,
    maxPending: 2,
    lost,
  });
  expect(await first.send(1)).toBe(false);
  const second = new CommandChannel<number>({ send: () => Promise.reject(new Error('private')), timeoutMs: 100, maxPending: 2, lost });
  expect(await second.send(2)).toBe(false);
  expect(lost).toHaveBeenCalledTimes(2);
});

it('reports a single loss when disposed before any frame is queued', async () => {
  const send = vi.fn<(frame: number) => Promise<void>>().mockResolvedValue(undefined);
  const lost = vi.fn<() => void>();
  const channel = new CommandChannel({ send, timeoutMs: 100, maxPending: 2, lost });
  channel.dispose();
  channel.dispose();
  expect(lost).toHaveBeenCalledOnce();
  expect(await channel.send(1)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it('settles active and queued sends on disposal and ignores a late rejection', async () => {
  const pending = Promise.withResolvers<void>();
  const send = vi.fn<(frame: number) => Promise<void>>().mockReturnValue(pending.promise);
  const lost = vi.fn<() => void>();
  const channel = new CommandChannel({ send, timeoutMs: 100, maxPending: 3, lost });
  const first = channel.send(1);
  const second = channel.send(2);
  channel.dispose();
  expect(await first).toBe(false);
  expect(await second).toBe(false);
  pending.reject(new Error('private transport failure'));
  await Promise.resolve();
  expect(lost).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(1);
});
