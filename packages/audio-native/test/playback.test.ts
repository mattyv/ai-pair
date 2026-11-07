import { expect, it, vi } from 'vitest';
import { PhysicalPlayback } from '../src/playback';
import type { AudioOwner } from '../src/index';

const owner: AudioOwner = { connectionEpoch: 'connection', jobId: 'job', pageEpoch: 1 };

it('makes all repeated stop calls wait for physical process close', async () => {
  const closed = Promise.withResolvers<void>();
  const stop = vi.fn<() => void>();
  const state = new PhysicalPlayback();
  expect(state.attach(owner, { stop, closed: closed.promise })).toBe(true);
  const first = state.stop(owner);
  const second = state.stop(owner);
  let settled = false;
  void first.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(state.attach({ ...owner, jobId: 'other' }, { stop, closed: Promise.resolve() })).toBe(false);
  closed.resolve();
  await Promise.all([first, second]);
  expect(settled).toBe(true);
  expect(state.attach({ ...owner, jobId: 'other' }, { stop, closed: Promise.resolve() })).toBe(true);
});

it('does not let a stale owner stop the physical process', async () => {
  const closed = Promise.withResolvers<void>();
  const stop = vi.fn<() => void>();
  const state = new PhysicalPlayback();
  expect(state.attach(owner, { stop, closed: closed.promise })).toBe(true);
  await state.stop({ ...owner, pageEpoch: 2 });
  expect(stop).not.toHaveBeenCalled();
  closed.resolve();
});

it('does not release ownership when signaling stop throws', async () => {
  const closed = Promise.withResolvers<void>();
  const state = new PhysicalPlayback();
  const stop = vi.fn<() => void>(() => {
    throw new Error('process error');
  });
  expect(state.attach(owner, { stop, closed: closed.promise })).toBe(true);
  const pending = state.stop(owner);
  expect(state.attach({ ...owner, jobId: 'other' }, { stop, closed: Promise.resolve() })).toBe(false);
  closed.resolve();
  await pending;
});

it('keeps the slot occupied if process retirement cannot be confirmed', async () => {
  const closed = Promise.withResolvers<void>();
  const stop = vi.fn<() => void>();
  const state = new PhysicalPlayback();
  expect(state.attach(owner, { stop, closed: closed.promise })).toBe(true);
  closed.reject(new Error('no close confirmation'));
  await Promise.resolve();
  await Promise.resolve();
  expect(state.attach({ ...owner, jobId: 'other' }, { stop, closed: Promise.resolve() })).toBe(false);
});

it('does not wait on a different owner or on an empty slot', async () => {
  const state = new PhysicalPlayback();
  await expect(state.wait(owner)).resolves.toBeUndefined();
  const closed = Promise.withResolvers<void>();
  expect(state.attach(owner, { stop: vi.fn<() => void>(), closed: closed.promise })).toBe(true);
  await expect(state.wait({ ...owner, connectionEpoch: 'old' })).resolves.toBeUndefined();
  closed.resolve();
  await state.wait(owner);
});
