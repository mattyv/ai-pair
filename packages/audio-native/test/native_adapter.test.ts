import { beforeEach, expect, it, vi } from 'vitest';
import { NativeAdapter } from '../src/native_adapter';
import type { AudioLease, AudioOwner } from '../src/index';

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  route: vi.fn(),
  recheck: vi.fn(),
  release: vi.fn(),
  attach: vi.fn(),
  wait: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../src/admission', () => ({
  AudioAdmission: class {
    admit = mocks.admit;
    route = mocks.route;
    recheck = mocks.recheck;
    stop = mocks.release;
  },
}));
vi.mock('../src/playback', () => ({
  PhysicalPlayback: class {
    attach = mocks.attach;
    wait = mocks.wait;
    stop = mocks.stop;
  },
}));
const owner: AudioOwner = { connectionEpoch: 'local', jobId: 'one', pageEpoch: 2 };
// A test-only opaque lease; the admission collaborator normally creates it.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const lease = 'lease-1' as AudioLease;
const devices = [{ id: 'a', label: 'A' }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admit.mockResolvedValue(lease);
  mocks.route.mockReturnValue('a');
  mocks.recheck.mockResolvedValue('a');
  mocks.release.mockResolvedValue(undefined);
  mocks.attach.mockReturnValue(true);
  mocks.wait.mockReturnValue(new Promise<void>(() => {}));
  mocks.stop.mockResolvedValue(undefined);
});

it('forwards discovery and starts the admitted exact route', async () => {
  let event: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const handle = { closed: Promise.resolve(), stop: vi.fn<() => void>(), pause: vi.fn<() => void>(), resume: vi.fn<() => void>() };
  const backend = {
    list: () => Promise.resolve(devices),
    start: vi.fn((id: string, wav: Uint8Array, callback: typeof event) => {
      expect(id).toBe('a');
      expect(wav.byteLength).toBe(44);
      event = callback;
      return handle;
    }),
  };
  const adapter = new NativeAdapter(backend);
  expect(await adapter.capabilities()).toMatchObject({ defaultOutput: false });
  expect(await adapter.list()).toEqual(devices);
  const listener = vi.fn<(...args: unknown[]) => void>();
  const subscription = adapter.onEvent(listener);
  expect(await adapter.admit(owner, { kind: 'device', id: 'a' })).toBe(lease);
  await adapter.play(lease, new Uint8Array(44));
  event?.('started');
  await Promise.resolve();
  expect(listener).toHaveBeenCalledWith({ owner, sequence: 1, part: 0, type: 'started' });
  await adapter.pause(owner);
  await adapter.resume(owner);
  expect(handle.pause).toHaveBeenCalledOnce();
  expect(handle.resume).toHaveBeenCalledOnce();
  subscription.dispose();
  event?.('ended');
  await Promise.resolve();
  expect(listener).toHaveBeenCalledOnce();
  await adapter.stop(owner);
  expect(mocks.release).toHaveBeenCalledWith(owner);
});

it('rejects stale or unavailable admission and does not launch on cancellation', async () => {
  const discovery = Promise.withResolvers<AudioLease>();
  mocks.admit.mockReturnValueOnce(discovery.promise);
  const backend = { list: () => Promise.resolve(devices), start: vi.fn() };
  const adapter = new NativeAdapter(backend);
  const pending = adapter.admit(owner, { kind: 'device', id: 'a' });
  await expect(adapter.admit(owner, { kind: 'device', id: 'a' })).rejects.toThrow();
  await adapter.stop(owner);
  discovery.resolve(lease);
  await expect(pending).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
  mocks.route.mockReturnValueOnce(undefined);
  await expect(adapter.admit(owner, { kind: 'device', id: 'a' })).rejects.toThrow();
});

it('fails closed for invalid play requests, missing routes and rejected attachment', async () => {
  const stop = vi.fn<() => void>();
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop, closed: Promise.resolve() })) };
  const first = new NativeAdapter(backend);
  await expect(first.play(lease, new Uint8Array(44))).rejects.toThrow();
  await first.admit(owner, { kind: 'device', id: 'a' });
  await expect(first.play(lease, new Uint8Array(1))).rejects.toThrow();
  mocks.recheck.mockResolvedValueOnce(undefined);
  await expect(first.play(lease, new Uint8Array(44))).rejects.toThrow();
  await expect(first.play(lease, new Uint8Array(44))).rejects.toThrow();
  await first.stop(owner);
  const second = new NativeAdapter(backend);
  await second.admit(owner, { kind: 'device', id: 'a' });
  mocks.attach.mockReturnValueOnce(false);
  await expect(second.play(lease, new Uint8Array(44))).rejects.toThrow();
  expect(stop).toHaveBeenCalledOnce();
});

it('keeps a discovery-time pause until resume and suppresses stale owner controls', async () => {
  const discovery = Promise.withResolvers<AudioLease>();
  mocks.admit.mockReturnValueOnce(discovery.promise);
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: Promise.resolve() })) };
  const adapter = new NativeAdapter(backend);
  const pending = adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  await adapter.resume({ ...owner, pageEpoch: 99 });
  discovery.resolve(lease);
  await pending;
  const play = adapter.play(lease, new Uint8Array(44));
  await vi.waitFor(() => {
    expect(mocks.recheck).toHaveBeenCalled();
  });
  await Promise.resolve();
  expect(backend.start).not.toHaveBeenCalled();
  await adapter.resume(owner);
  await play;
  expect(backend.start).toHaveBeenCalledOnce();
});

it('drops queued stale events after the matching child closes', async () => {
  const retired = Promise.withResolvers<void>();
  mocks.wait.mockReturnValueOnce(retired.promise);
  let callback: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const backend = {
    list: () => Promise.resolve(devices),
    start: vi.fn((id: string, wav: Uint8Array, event: typeof callback) => {
      expect(id).toBe('a');
      expect(wav.byteLength).toBe(44);
      void id;
      void wav;
      callback = event;
      return { stop: vi.fn<() => void>(), closed: Promise.resolve() };
    }),
  };
  const adapter = new NativeAdapter(backend);
  const listener = vi.fn<(...args: unknown[]) => void>();
  adapter.onEvent(listener);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  retired.resolve();
  await retired.promise;
  await Promise.resolve();
  expect(mocks.release).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledWith({ owner, sequence: 1, part: 0, type: 'failed' });
  callback?.('ended');
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  await adapter.stop(owner);
  expect(mocks.release).toHaveBeenCalledWith(owner);
});

it('rejects a paused pending play when stopped and wakes the waiter', async () => {
  const backend = { list: () => Promise.resolve(devices), start: vi.fn() };
  const adapter = new NativeAdapter(backend);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  const playing = adapter.play(lease, new Uint8Array(44));
  await vi.waitFor(() => {
    expect(mocks.recheck).toHaveBeenCalledOnce();
  });
  await Promise.resolve();
  await adapter.stop(owner);
  await expect(playing).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
});

it('handles stop and close notifications in either order', async () => {
  const retired = Promise.withResolvers<void>();
  const stopping = Promise.withResolvers<void>();
  mocks.wait.mockReturnValueOnce(retired.promise);
  mocks.stop.mockReturnValueOnce(stopping.promise);
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: Promise.resolve() })) };
  const adapter = new NativeAdapter(backend);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  const done = adapter.stop(owner);
  retired.resolve();
  await retired.promise;
  await Promise.resolve();
  stopping.resolve();
  await done;
  expect(mocks.release).toHaveBeenCalledWith(owner);
});

it('allows a pending admission to be paused and resumed before discovery returns', async () => {
  const discovery = Promise.withResolvers<AudioLease>();
  mocks.admit.mockReturnValueOnce(discovery.promise);
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: Promise.resolve() })) };
  const adapter = new NativeAdapter(backend);
  const pending = adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.pause(owner);
  await adapter.resume(owner);
  discovery.resolve(lease);
  await pending;
  await adapter.play(lease, new Uint8Array(44));
  expect(backend.start).toHaveBeenCalledOnce();
});

it('ignores a late close callback after stop already cleared the old job', async () => {
  const retired = Promise.withResolvers<void>();
  mocks.wait.mockReturnValueOnce(retired.promise);
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: Promise.resolve() })) };
  const adapter = new NativeAdapter(backend);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44));
  await adapter.stop(owner);
  mocks.release.mockClear();
  retired.resolve();
  await retired.promise;
  await Promise.resolve();
  expect(mocks.release).not.toHaveBeenCalled();
});

it('rechecks the route when pause and resume occur during discovery', async () => {
  const pending = Promise.withResolvers<string>();
  mocks.recheck.mockReturnValueOnce(pending.promise).mockResolvedValue('a');
  const backend = { list: () => Promise.resolve(devices), start: vi.fn(() => ({ stop: vi.fn<() => void>(), closed: Promise.resolve() })) };
  const adapter = new NativeAdapter(backend);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  const play = adapter.play(lease, new Uint8Array(44), 0);
  await adapter.pause(owner);
  await adapter.resume(owner);
  pending.resolve('a');
  await play;
  expect(mocks.recheck).toHaveBeenCalledTimes(2);
  expect(backend.start).toHaveBeenCalledOnce();
  await adapter.stop(owner);
});

it('suppresses duplicate starts and a start queued before cancellation', async () => {
  let callback: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const backend = {
    list: () => Promise.resolve(devices),
    start: (id: string, wav: Uint8Array, event: typeof callback) => {
      void id;
      void wav;
      callback = event;
      return { stop: vi.fn<() => void>(), closed: Promise.resolve() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const listener = vi.fn<(...args: unknown[]) => void>();
  adapter.onEvent(listener);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  callback?.('started');
  callback?.('started');
  const stopped = adapter.stop(owner);
  await stopped;
  expect(listener).not.toHaveBeenCalled();
});

it('publishes a natural part only after close and keeps its logical lease', async () => {
  const retired = Promise.withResolvers<void>();
  mocks.wait.mockReturnValueOnce(retired.promise);
  let callback: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const backend = {
    list: () => Promise.resolve(devices),
    start: (id: string, wav: Uint8Array, event: typeof callback) => {
      void id;
      void wav;
      callback = event;
      return { stop: vi.fn<() => void>(), closed: Promise.resolve() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const listener = vi.fn<(...args: unknown[]) => void>();
  adapter.onEvent(listener);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  callback?.('started');
  await Promise.resolve();
  callback?.('ended');
  expect(listener).toHaveBeenCalledTimes(1);
  retired.resolve();
  await vi.waitFor(() => {
    expect(listener).toHaveBeenCalledWith({ owner, sequence: 2, part: 0, type: 'ended' });
  });
  expect(mocks.release).not.toHaveBeenCalled();
  await adapter.stop(owner);
});

it('publishes canceled physical completion and blocks later parts', async () => {
  const retired = Promise.withResolvers<void>();
  mocks.wait.mockReturnValueOnce(retired.promise);
  let callback: ((type: 'started' | 'ended' | 'canceled' | 'failed') => void) | undefined;
  const backend = {
    list: () => Promise.resolve(devices),
    start: (id: string, wav: Uint8Array, event: typeof callback) => {
      void id;
      void wav;
      callback = event;
      return { stop: vi.fn<() => void>(), closed: Promise.resolve() };
    },
  };
  const adapter = new NativeAdapter(backend);
  const listener = vi.fn<(...args: unknown[]) => void>();
  adapter.onEvent(listener);
  await adapter.admit(owner, { kind: 'device', id: 'a' });
  await adapter.play(lease, new Uint8Array(44), 0);
  callback?.('canceled');
  retired.resolve();
  await vi.waitFor(() => {
    expect(listener).toHaveBeenCalledWith({ owner, sequence: 1, part: 0, type: 'canceled' });
  });
  await expect(adapter.play(lease, new Uint8Array(44), 0)).rejects.toThrow();
  await adapter.stop(owner);
});
