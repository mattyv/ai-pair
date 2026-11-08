import { expect, it, vi } from 'vitest';
import { NativeAdapter } from '../src/native_adapter';
import type { AudioEvent, AudioOwner } from '../src/index';

const owner: AudioOwner = { connectionEpoch: 'connection', jobId: 'unit', pageEpoch: 7 };

it('retains one exact route across parts and publishes completion only after child close', async () => {
  let defaultId = 'device-a';
  const callbacks: Array<(event: AudioEvent['type']) => void> = [];
  const closes: Array<ReturnType<typeof Promise.withResolvers<void>>> = [];
  const backend = {
    defaultId: () => Promise.resolve(defaultId),
    list: () =>
      Promise.resolve([
        { id: 'device-a', label: 'A' },
        { id: 'device-b', label: 'B' },
      ]),
    start: vi.fn((route: string, wav: Uint8Array, event: (type: AudioEvent['type']) => void) => {
      void wav;
      expect(route).toBe('device-a');
      callbacks.push(event);
      const closed = Promise.withResolvers<void>();
      closes.push(closed);
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    }),
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'default' });
  await adapter.play(lease, new Uint8Array(44), 0);
  callbacks[0]?.('started');
  await Promise.resolve();
  callbacks[0]?.('ended');
  await Promise.resolve();
  expect(events).toMatchObject([{ part: 0, type: 'started' }]);
  await expect(adapter.play(lease, new Uint8Array(44), 1)).rejects.toThrow();
  closes[0]?.resolve();
  await vi.waitFor(() => {
    expect(events).toMatchObject([
      { part: 0, type: 'started' },
      { owner, part: 0, type: 'ended' },
    ]);
  });
  defaultId = 'device-b';
  await adapter.play(lease, new Uint8Array(44), 1);
  expect(backend.start).toHaveBeenCalledTimes(2);
  callbacks[0]?.('ended');
  await Promise.resolve();
  expect(events).toHaveLength(2);
  callbacks[1]?.('started');
  await Promise.resolve();
  callbacks[1]?.('ended');
  closes[1]?.resolve();
  await vi.waitFor(() => {
    expect(events).toMatchObject([{ part: 0 }, { part: 0 }, { part: 1, type: 'started' }, { part: 1, type: 'ended' }]);
  });
  await adapter.stop(owner);
});

it('rejects overlapping, repeated and skipped parts without launching another child', async () => {
  const closed = Promise.withResolvers<void>();
  let signal: ((type: AudioEvent['type']) => void) | undefined;
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: vi.fn((_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      signal = callback;
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    }),
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await expect(adapter.play(lease, new Uint8Array(44), 1)).rejects.toThrow();
  await adapter.play(lease, new Uint8Array(44), 0);
  await expect(adapter.play(lease, new Uint8Array(44), 0)).rejects.toThrow();
  await expect(adapter.play(lease, new Uint8Array(44), 1)).rejects.toThrow();
  signal?.('started');
  await Promise.resolve();
  signal?.('ended');
  closed.resolve();
  await vi.waitFor(() => {
    expect(events).toHaveLength(2);
  });
  await expect(adapter.play(lease, new Uint8Array(44), 0)).rejects.toThrow();
  await expect(adapter.play(lease, new Uint8Array(44), 2)).rejects.toThrow();
  expect(backend.start).toHaveBeenCalledTimes(1);
  await adapter.stop(owner);
});

it('rechecks the captured route after a paused boundary and refuses a missing device', async () => {
  let present = true;
  const closed = Promise.withResolvers<void>();
  let signal: ((type: AudioEvent['type']) => void) | undefined;
  const backend = {
    list: vi.fn(() => Promise.resolve(present ? [{ id: 'device-a', label: 'A' }] : [])),
    start: vi.fn((_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      signal = callback;
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    }),
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  signal?.('started');
  await Promise.resolve();
  signal?.('ended');
  closed.resolve();
  await vi.waitFor(() => {
    expect(events).toHaveLength(2);
  });
  await adapter.pause(owner);
  const next = adapter.play(lease, new Uint8Array(44), 1);
  await vi.waitFor(() => {
    expect(backend.list).toHaveBeenCalledTimes(3);
  });
  expect(backend.start).toHaveBeenCalledTimes(1);
  present = false;
  await adapter.resume(owner);
  await expect(next).rejects.toThrow();
  expect(backend.start).toHaveBeenCalledTimes(1);
  await adapter.stop(owner);
});

it('suppresses a pending natural end after cancellation and waits for child close', async () => {
  const closed = Promise.withResolvers<void>();
  let signal: ((type: AudioEvent['type']) => void) | undefined;
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: (_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      signal = callback;
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  signal?.('ended');
  const stop = adapter.stop(owner);
  let retired = false;
  void stop.then(() => {
    retired = true;
  });
  await Promise.resolve();
  expect(retired).toBe(false);
  expect(events).toEqual([]);
  closed.resolve();
  await stop;
  expect(events).toEqual([]);
});

it('rechecks when pause and resume both occur during an in-flight route check', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = {
    list: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'device-a', label: 'A' }])
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue([]),
    start: vi.fn(),
  };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  const play = adapter.play(lease, new Uint8Array(44), 0);
  await adapter.pause(owner);
  await adapter.resume(owner);
  pending.resolve([{ id: 'device-a', label: 'A' }]);
  await expect(play).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
  await adapter.stop(owner);
});

it('requires a started event, suppresses duplicate starts, and isolates listener errors', async () => {
  const closed = Promise.withResolvers<void>();
  let signal: ((type: AudioEvent['type']) => void) | undefined;
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: (_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      signal = callback;
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const observed: AudioEvent[] = [];
  adapter.onEvent(() => {
    throw new Error('private listener failure');
  });
  adapter.onEvent((event) => {
    observed.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  signal?.('started');
  signal?.('started');
  await Promise.resolve();
  expect(observed).toMatchObject([{ part: 0, type: 'started' }]);
  signal?.('ended');
  closed.resolve();
  await vi.waitFor(() => {
    expect(observed).toMatchObject([{ type: 'started' }, { type: 'ended' }]);
  });
  await adapter.stop(owner);
});

it('treats end before start as failure and cannot launch another part', async () => {
  const closed = Promise.withResolvers<void>();
  let signal: ((type: AudioEvent['type']) => void) | undefined;
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: (_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      signal = callback;
      return { closed: closed.promise, stop: vi.fn<() => void>() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  signal?.('ended');
  signal?.('started');
  closed.resolve();
  await vi.waitFor(() => {
    expect(events).toMatchObject([{ part: 0, type: 'failed' }]);
  });
  await expect(adapter.play(lease, new Uint8Array(44), 1)).rejects.toThrow();
  await adapter.stop(owner);
});

it('retains a failed part until explicit stop after an earlier part completes', async () => {
  const closes = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const callbacks: Array<(type: AudioEvent['type']) => void> = [];
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: (_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      const close = closes[callbacks.length];
      if (!close) throw new Error('unexpected child');
      callbacks.push(callback);
      return { closed: close.promise, stop: vi.fn<() => void>() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  callbacks[0]?.('started');
  await Promise.resolve();
  callbacks[0]?.('ended');
  closes[0]?.resolve();
  await vi.waitFor(() => {
    expect(events).toHaveLength(2);
  });
  await adapter.play(lease, new Uint8Array(44), 1);
  callbacks[1]?.('failed');
  closes[1]?.resolve();
  await vi.waitFor(() => {
    expect(events.at(-1)).toMatchObject({ part: 1, type: 'failed' });
  });
  await expect(adapter.play(lease, new Uint8Array(44), 1)).rejects.toThrow();
  await expect(adapter.play(lease, new Uint8Array(44), 2)).rejects.toThrow();
  await adapter.stop(owner);
});

it('releases a reserved unit when recheck or process launch fails', async () => {
  for (const failAt of ['recheck', 'launch'] as const) {
    const list = vi.fn().mockResolvedValueOnce([{ id: 'device-a', label: 'A' }]);
    list.mockResolvedValue(failAt === 'recheck' ? [] : [{ id: 'device-a', label: 'A' }]);
    const backend = {
      list,
      start: () => {
        throw new Error('private');
      },
    };
    const adapter = new NativeAdapter(backend);
    const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
    await expect(adapter.play(lease, new Uint8Array(44), 0)).rejects.toThrow();
    await adapter.stop(owner);
    list.mockResolvedValue([{ id: 'device-a', label: 'A' }]);
    await expect(adapter.admit({ ...owner, jobId: 'next' }, { kind: 'device', id: 'device-a' })).resolves.toBeTruthy();
  }
});

it('caps a unit at four parts and releases the lease only on explicit stop', async () => {
  const callbacks: Array<(type: AudioEvent['type']) => void> = [];
  const closes: Array<ReturnType<typeof Promise.withResolvers<void>>> = [];
  const backend = {
    list: () => Promise.resolve([{ id: 'device-a', label: 'A' }]),
    start: (_: string, wav: Uint8Array, callback: (type: AudioEvent['type']) => void) => {
      void wav;
      callbacks.push(callback);
      const close = Promise.withResolvers<void>();
      closes.push(close);
      return { closed: close.promise, stop: vi.fn<() => void>() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const events: AudioEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  for (let part = 0; part < 4; part++) {
    await adapter.play(lease, new Uint8Array(44), part);
    callbacks[part]?.('started');
    await Promise.resolve();
    callbacks[part]?.('ended');
    closes[part]?.resolve();
    await vi.waitFor(() => {
      expect(events).toHaveLength((part + 1) * 2);
    });
  }
  await expect(adapter.play(lease, new Uint8Array(44), 4)).rejects.toThrow();
  await expect(adapter.admit({ ...owner, jobId: 'new' }, { kind: 'device', id: 'device-a' })).rejects.toThrow();
  await adapter.stop(owner);
  await expect(adapter.admit({ ...owner, jobId: 'new' }, { kind: 'device', id: 'device-a' })).resolves.toBeTruthy();
});
