import { expect, it, vi } from 'vitest';
import { NativeAdapter } from '../src/native_adapter';
import type { AudioOwner } from '../src/index';

const owner: AudioOwner = { connectionEpoch: 'local', jobId: 'one', pageEpoch: 2 };

it('refuses playback when the captured output disappears before the physical open', async () => {
  const backend = {
    list: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a', label: 'A' }])
      .mockResolvedValueOnce([]),
    start: vi.fn(),
  };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await expect(adapter.play(lease, new Uint8Array(44))).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
});

it('holds admission during all concurrent stop calls until the child closes', async () => {
  const closed = Promise.withResolvers<void>();
  const stop = vi.fn<() => void>();
  const backend = {
    list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]),
    start: vi.fn(() => ({ stop, closed: closed.promise })),
  };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  const first = adapter.stop(owner);
  const second = adapter.stop(owner);
  await expect(adapter.admit({ ...owner, jobId: 'next' }, { kind: 'device', id: 'a' })).rejects.toThrow();
  expect(stop).toHaveBeenCalledTimes(1);
  closed.resolve();
  await Promise.all([first, second]);
  await expect(adapter.admit({ ...owner, jobId: 'next' }, { kind: 'device', id: 'a' })).resolves.toBeTruthy();
});

it('cancels pending admission and refuses its late result', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = { list: vi.fn(() => pending.promise), start: vi.fn() };
  const adapter = new NativeAdapter(backend);
  const result = adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.stop(owner);
  pending.resolve([{ id: 'a', label: 'A' }]);
  await expect(result).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
});

it('ignores stale controls and releases a naturally closed process', async () => {
  const closed = Promise.withResolvers<void>();
  const stop = vi.fn<() => void>();
  const pause = vi.fn<() => void>();
  const resume = vi.fn<() => void>();
  const backend = {
    list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]),
    start: vi.fn(() => ({ stop, pause, resume, closed: closed.promise })),
  };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  await adapter.pause({ ...owner, pageEpoch: 3 });
  await adapter.stop({ ...owner, pageEpoch: 3 });
  expect(pause).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  await adapter.pause(owner);
  await adapter.resume(owner);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(resume).toHaveBeenCalledTimes(1);
  closed.resolve();
  await vi.waitFor(async () => {
    await expect(adapter.admit({ ...owner, jobId: 'next' }, { kind: 'device', id: 'a' })).resolves.toBeTruthy();
  });
});

it('does not start a process when stop races an immediately resolved playback recheck', async () => {
  const backend = { list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]), start: vi.fn() };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  const play = adapter.play(lease, new Uint8Array(44));
  const stop = adapter.stop(owner);
  await expect(play).rejects.toThrow();
  await stop;
  expect(backend.start).not.toHaveBeenCalled();
});

it('retains a pause requested before a native process is attached', async () => {
  const closed = Promise.withResolvers<void>();
  const pause = vi.fn<() => void>();
  const backend = {
    list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]),
    start: vi.fn(() => ({ stop: vi.fn<() => void>(), pause, closed: closed.promise })),
  };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  const play = adapter.play(lease, new Uint8Array(44));
  await vi.waitFor(() => {
    expect(backend.list).toHaveBeenCalledTimes(2);
  });
  await Promise.resolve();
  expect(backend.start).not.toHaveBeenCalled();
  await adapter.resume(owner);
  await play;
  expect(backend.start).toHaveBeenCalledTimes(1);
  expect(pause).not.toHaveBeenCalled();
  closed.resolve();
});

it('retains a pause while admission discovery is pending', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const closed = Promise.withResolvers<void>();
  const backend = {
    list: vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue([{ id: 'a', label: 'A' }]),
    start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: closed.promise })),
  };
  const adapter = new NativeAdapter(backend);
  const admitting = adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  pending.resolve([{ id: 'a', label: 'A' }]);
  const lease = await admitting;
  const play = adapter.play(lease, new Uint8Array(44));
  await vi.waitFor(() => {
    expect(backend.list).toHaveBeenCalledTimes(2);
  });
  await Promise.resolve();
  expect(backend.start).not.toHaveBeenCalled();
  await adapter.resume(owner);
  await play;
  closed.resolve();
});

it('wakes and cancels a paused pending play without launching a process', async () => {
  const backend = { list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]), start: vi.fn() };
  const adapter = new NativeAdapter(backend);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  const play = adapter.play(lease, new Uint8Array(44));
  await vi.waitFor(() => {
    expect(backend.list).toHaveBeenCalledTimes(2);
  });
  const stopping = adapter.stop(owner);
  await expect(play).rejects.toThrow();
  await stopping;
  expect(backend.start).not.toHaveBeenCalled();
});

it('delivers scoped events and ignores callbacks after the old process closes', async () => {
  const closed = Promise.withResolvers<void>();
  let signal: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const backend = {
    list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]),
    start: vi.fn((id: string, wav: Uint8Array, event: (type: 'started' | 'ended' | 'canceled' | 'failed') => void) => {
      expect(id).toBe('a');
      expect(wav.byteLength).toBe(44);
      signal = event;
      return { stop: vi.fn<() => void>(), closed: closed.promise };
    }),
  };
  const adapter = new NativeAdapter(backend);
  const observed = vi.fn<(...args: unknown[]) => void>();
  const subscription = adapter.onEvent(observed);
  const lease = await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  signal?.('started');
  await Promise.resolve();
  expect(observed).toHaveBeenCalledWith({ owner, sequence: 1, type: 'started' });
  closed.resolve();
  await vi.waitFor(async () => {
    await expect(adapter.admit({ ...owner, jobId: 'next' }, { kind: 'device', id: 'a' })).resolves.toBeTruthy();
  });
  signal?.('ended');
  await Promise.resolve();
  expect(observed).toHaveBeenCalledTimes(1);
  subscription.dispose();
});
