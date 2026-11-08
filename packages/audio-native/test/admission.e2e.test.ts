import { expect, it, vi } from 'vitest';
import { AudioAdmission } from '../src/admission';
import type { AudioOwner } from '../src/index';

const owner: AudioOwner = { connectionEpoch: 'a', jobId: 'one', pageEpoch: 1 };

it('validates and snapshots the selected route before admitting a job', async () => {
  const backend = { list: vi.fn(() => Promise.resolve([{ id: 'device-a', label: 'A' }])), start: vi.fn() };
  const adapter = new AudioAdmission(backend);
  await expect(adapter.admit(owner, { kind: 'device', id: 'missing' })).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
  const lease = await adapter.admit(owner, { kind: 'device', id: 'device-a' });
  expect(lease).toBeTruthy();
  expect(backend.start).not.toHaveBeenCalled();
  await expect(adapter.admit({ ...owner, jobId: 'two' }, { kind: 'default' })).rejects.toThrow();
});

it('cancels pending admission and ignores late discovery after stop', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = { list: vi.fn(() => pending.promise), start: vi.fn() };
  const adapter = new AudioAdmission(backend);
  const admission = adapter.admit(owner, { kind: 'device', id: 'device-a' });
  await adapter.stop(owner);
  pending.resolve([{ id: 'device-a', label: 'A' }]);
  await expect(admission).rejects.toThrow();
  expect(backend.start).not.toHaveBeenCalled();
});

it('cannot let an old canceled discovery clear a newer owner', async () => {
  const first = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const second = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = { list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), start: vi.fn() };
  const admission = new AudioAdmission(backend);
  const old = admission.admit(owner, { kind: 'device', id: 'device-a' });
  await admission.stop(owner);
  const newer = admission.admit({ ...owner, jobId: 'two' }, { kind: 'device', id: 'device-a' });
  first.resolve([{ id: 'device-a', label: 'A' }]);
  await expect(old).rejects.toThrow();
  second.resolve([{ id: 'device-a', label: 'A' }]);
  await expect(newer).resolves.toBeTruthy();
  await expect(admission.admit(owner, { kind: 'device', id: 'device-a' })).rejects.toThrow();
});

it('snapshots the concrete default endpoint for the lease', async () => {
  const backend = {
    list: vi.fn(() =>
      Promise.resolve([
        { id: 'device-a', label: 'A' },
        { id: 'device-b', label: 'B' },
      ]),
    ),
    defaultId: vi.fn().mockResolvedValueOnce('device-a').mockResolvedValue('device-b'),
  };
  const admission = new AudioAdmission(backend);
  const lease = await admission.admit(owner, { kind: 'default' });
  expect(admission.route(lease)).toBe('device-a');
  expect(await backend.defaultId()).toBe('device-b');
  expect(admission.route(lease)).toBe('device-a');
  await admission.stop(owner);
  expect(admission.route(lease)).toBeUndefined();
});

it('releases a failed admission even when its caller mutates the owner object', async () => {
  const first = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = {
    list: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue([{ id: 'device-a', label: 'A' }]),
  };
  const admission = new AudioAdmission(backend);
  const mutable = { ...owner };
  const failed = admission.admit(mutable, { kind: 'device', id: 'missing' });
  mutable.jobId = 'changed';
  first.resolve([]);
  await expect(failed).rejects.toThrow();
  await expect(admission.admit(owner, { kind: 'device', id: 'device-a' })).resolves.toBeTruthy();
});

it('rechecks the captured route and fails if it disappears before playback', async () => {
  const backend = {
    list: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'device-a', label: 'A' }])
      .mockResolvedValueOnce([]),
  };
  const admission = new AudioAdmission(backend);
  const lease = await admission.admit(owner, { kind: 'device', id: 'device-a' });
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
  expect(admission.route(lease)).toBe('device-a');
});

it('rejects a late successful recheck after cancellation', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; label: string }>>();
  const backend = {
    list: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'device-a', label: 'A' }])
      .mockReturnValueOnce(pending.promise),
  };
  const admission = new AudioAdmission(backend);
  const lease = await admission.admit(owner, { kind: 'device', id: 'device-a' });
  const recheck = admission.recheck(lease);
  await admission.stop(owner);
  pending.resolve([{ id: 'device-a', label: 'A' }]);
  await expect(recheck).resolves.toBeUndefined();
});

it('rechecks an available route and treats discovery errors as unavailable', async () => {
  const backend = { list: vi.fn().mockResolvedValue([{ id: 'device-a', label: 'A' }]) };
  const admission = new AudioAdmission(backend);
  const lease = await admission.admit(owner, { kind: 'device', id: 'device-a' });
  await expect(admission.recheck(lease)).resolves.toBe('device-a');
  backend.list.mockRejectedValueOnce(new Error('untrusted backend error'));
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
  await admission.stop({ ...owner, pageEpoch: 99 });
  expect(admission.route(lease)).toBe('device-a');
  await admission.stop(owner);
  await expect(admission.recheck(lease)).resolves.toBeUndefined();
});
