import { expect, it, vi } from 'vitest';
import { Ownership } from '../src/ownership';

const uuid = vi.hoisted(() => vi.fn());
vi.mock('node:crypto', () => ({ randomUUID: uuid }));

it('reserves one immutable owner and only retires the matching lease and owner', () => {
  uuid.mockReturnValueOnce('first').mockReturnValueOnce('second');
  const state = new Ownership();
  const owner = { connectionEpoch: 'a', jobId: 'job', pageEpoch: 1 };
  expect(state.hasLease(undefined)).toBe(false);
  expect(state.matches(owner)).toBe(false);
  const first = state.reserve(owner);
  expect(state.reserve(owner)).toBeUndefined();
  expect(state.hasLease(first)).toBe(true);
  expect(state.matches({ ...owner, pageEpoch: 2 })).toBe(false);
  expect(state.retire(first, { ...owner, jobId: 'other' })).toBe(false);
  expect(state.retire(first, owner)).toBe(true);
  const second = state.reserve(owner);
  expect(state.retire(first, owner)).toBe(false);
  expect(state.hasLease(second)).toBe(true);
});
