import { beforeEach, expect, it, vi } from 'vitest';
import { AudioAdmission } from '../src/admission';
import type { AudioLease } from '../src/index';

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), retire: vi.fn(), hasLease: vi.fn(), matches: vi.fn() }));
vi.mock('../src/ownership', () => ({
  Ownership: class {
    reserve = mocks.reserve;
    retire = mocks.retire;
    hasLease = mocks.hasLease;
    matches = mocks.matches;
  },
}));
const owner = { connectionEpoch: 'local', jobId: 'one', pageEpoch: 1 };
// The mocked ownership collaborator returns this branded value.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const lease = 'lease' as AudioLease;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reserve.mockReturnValue(lease);
  mocks.hasLease.mockReturnValue(true);
  mocks.matches.mockReturnValue(true);
  mocks.retire.mockReturnValue(true);
});

it('reserves and rechecks the captured concrete default', async () => {
  const discovery = { list: vi.fn().mockResolvedValue([{ id: 'a', label: 'A' }]), defaultId: vi.fn().mockResolvedValue('a') };
  const admission = new AudioAdmission(discovery);
  expect(await admission.admit(owner, { kind: 'default' })).toBe(lease);
  expect(admission.route(lease)).toBe('a');
  await expect(admission.recheck(lease)).resolves.toBe('a');
  await admission.stop(owner);
  expect(mocks.retire).toHaveBeenCalledWith(lease, owner);
});

it('fails closed for busy, missing, unavailable and failed discovery', async () => {
  const discovery = { list: vi.fn().mockResolvedValue([]), defaultId: vi.fn().mockResolvedValue(undefined) };
  const admission = new AudioAdmission(discovery);
  mocks.reserve.mockReturnValueOnce(undefined);
  await expect(admission.admit(owner, { kind: 'device', id: 'a' })).rejects.toThrow();
  await expect(admission.admit(owner, { kind: 'default' })).rejects.toThrow();
  await expect(admission.admit(owner, { kind: 'device', id: '' })).rejects.toThrow();
  await expect(admission.admit(owner, { kind: 'device', id: 'missing' })).rejects.toThrow();
  discovery.list.mockRejectedValueOnce(new Error('private'));
  await expect(admission.admit(owner, { kind: 'device', id: 'a' })).rejects.toThrow('unavailable');
});

it('ignores a late discovery or recheck after cancellation', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const discovery = {
    list: vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue([{ id: 'a', label: 'A' }]),
  };
  const admission = new AudioAdmission(discovery);
  const first = admission.admit(owner, { kind: 'device', id: 'a' });
  await admission.stop(owner);
  pending.resolve([{ id: 'a', label: 'A' }]);
  await expect(first).rejects.toThrow();
  await admission.admit(owner, { kind: 'device', id: 'a' });
  mocks.hasLease.mockReturnValueOnce(false);
  expect(admission.route(lease)).toBeUndefined();
  discovery.list.mockRejectedValueOnce(new Error('unavailable'));
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
  mocks.matches.mockReturnValueOnce(false);
  await admission.stop({ ...owner, pageEpoch: 2 });
});

it('rejects recheck for a missing lease, missing device, or canceled in-flight check', async () => {
  const check = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const discovery = {
    list: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a', label: 'A' }])
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(check.promise),
  };
  const admission = new AudioAdmission(discovery);
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
  await admission.admit(owner, { kind: 'device', id: 'a' });
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
  const pending = admission.recheck(lease);
  await admission.stop(owner);
  check.resolve([{ id: 'a', label: 'A' }]);
  await expect(pending).resolves.toBeUndefined();
});
