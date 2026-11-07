import { expect, it } from 'vitest';
import { Ownership } from '../src/ownership';
import type { AudioOwner } from '../src/index';

const owner: AudioOwner = { connectionEpoch: 'connection-a', jobId: 'job-a', pageEpoch: 1 };

it('holds exclusive ownership until the corresponding process has actually retired', () => {
  const state = new Ownership();
  const lease = state.reserve(owner);
  expect(lease).toBeDefined();
  expect(state.reserve({ ...owner, jobId: 'job-b' })).toBeUndefined();
  expect(state.retire(lease, { ...owner, pageEpoch: 2 })).toBe(false);
  expect(state.reserve(owner)).toBeUndefined();
  expect(state.retire(lease, owner)).toBe(true);
  expect(state.reserve(owner)).toBeDefined();
});

it('snapshots owner identity and rejects leases after retirement or replacement', () => {
  const state = new Ownership();
  const mutable = { ...owner };
  const first = state.reserve(mutable);
  mutable.jobId = 'changed';
  expect(state.matches(owner)).toBe(true);
  expect(state.matches(mutable)).toBe(false);
  expect(state.hasLease(first)).toBe(true);
  expect(state.retire(first, owner)).toBe(true);
  const second = state.reserve(owner);
  expect(state.hasLease(first)).toBe(false);
  expect(state.retire(first, owner)).toBe(false);
  expect(state.hasLease(second)).toBe(true);
});
