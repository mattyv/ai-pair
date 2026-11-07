import { expect, it, vi } from 'vitest';
import { SpeechOutputPreferences } from '../src/speech_output_preferences';

const defaultOutput = { kind: 'default' } as const;
const headphones = { kind: 'native', backend: 'pipewire', name: 'headphones' } as const;
const speakers = { kind: 'native', backend: 'pipewire', name: 'speakers' } as const;

/** Creates a preference controller with isolated collaborators. */
function harness(initial?: unknown) {
  const write = vi.fn<(value: unknown) => Promise<void>>().mockResolvedValue();
  const stop = vi.fn<() => void>();
  const changed = vi.fn<(value: import('../src/speech_output_preferences').OutputPreferenceView) => void>();
  const discover = vi.fn<() => Promise<Omit<import('../src/speech_output_types').OutputCatalog, 'selected'>>>().mockResolvedValue({
    supported: true,
    devices: [
      { choice: headphones, label: 'Headphones', available: true },
      { choice: speakers, label: 'Speakers', available: true },
    ],
  });
  const preferences = new SpeechOutputPreferences({ initial, write, stop, changed, discover });
  return { preferences, write, stop, changed, discover };
}

it('defaults invalid stored values and retains a validated missing device', () => {
  expect(harness({ kind: 'native', backend: 'pipewire', name: '' }).preferences.choice()).toEqual(defaultOutput);
  expect(harness(headphones).preferences.choice()).toEqual(headphones);
});

it('stops speech before immediate selection and persists only the choice', async () => {
  const { preferences, write, stop, changed } = harness();
  await preferences.refresh();
  changed.mockClear();
  const pending = Promise.withResolvers<void>();
  write.mockReturnValueOnce(pending.promise);
  const promise = preferences.choose(headphones);
  expect(stop).toHaveBeenCalledOnce();
  expect(preferences.choice()).toEqual(headphones);
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(changed.mock.invocationCallOrder[0] ?? 0);
  await Promise.resolve();
  expect(write).toHaveBeenCalledWith(headphones);
  pending.resolve();
  await promise;
});

it('serializes writes and ignores an older failed write after a newer selection', async () => {
  const { preferences, write } = harness();
  await preferences.refresh();
  const first = Promise.withResolvers<void>();
  write.mockReturnValueOnce(first.promise);
  const a = preferences.choose(headphones);
  const b = preferences.choose(speakers);
  expect(preferences.choice()).toEqual(speakers);
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  first.reject(new Error('private'));
  await Promise.all([a, b]);
  expect(preferences.choice()).toEqual(speakers);
  expect(write.mock.calls).toEqual([[headphones], [speakers]]);
});

it('rolls back a latest failed write and exposes a fixed error', async () => {
  const { preferences, write, changed, stop } = harness();
  await preferences.refresh();
  write.mockRejectedValueOnce(new Error('private'));
  await preferences.choose(headphones);
  expect(preferences.choice()).toEqual(defaultOutput);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ selected: defaultOutput, error: 'save_failed' }));
  expect(JSON.stringify(changed.mock.calls)).not.toContain('private');
});

it('ignores stale discovery and keeps a missing saved output selected', async () => {
  const { preferences, discover, changed } = harness(headphones);
  const first = Promise.withResolvers<{ supported: boolean; devices: [] }>();
  discover.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ supported: true, devices: [] });
  const a = preferences.refresh();
  await preferences.refresh();
  first.resolve({ supported: false, devices: [] });
  await a;
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ supported: true, devices: [], selected: headphones }));
});

it('rejects forged or unavailable native output choices without stopping playback', async () => {
  const { preferences, write, stop, changed } = harness();
  await preferences.choose(headphones);
  await preferences.refresh();
  changed.mockClear();
  await preferences.choose({ kind: 'native', backend: 'pipewire', name: 'forged' });
  await preferences.choose({ kind: 'native', backend: 'invalid', name: 'x' });
  expect(preferences.choice()).toEqual(defaultOutput);
  expect(stop).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ selected: defaultOutput }));
});

it('shows initial state and clears discovery after a current failure', async () => {
  const { preferences, discover, changed } = harness({ kind: 'default' });
  expect(preferences.view()).toEqual({ supported: false, devices: [], selected: defaultOutput });
  discover.mockRejectedValueOnce(new Error('private'));
  await preferences.refresh();
  expect(changed).toHaveBeenLastCalledWith({ supported: false, devices: [], selected: defaultOutput, reason: 'unavailable' });
});

it('ignores an older discovery rejection after a newer success', async () => {
  const { preferences, discover, changed } = harness();
  const stale = Promise.withResolvers<Omit<import('../src/speech_output_types').OutputCatalog, 'selected'>>();
  discover.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ supported: true, devices: [] });
  const first = preferences.refresh();
  await preferences.refresh();
  stale.reject(new Error('private'));
  await first;
  expect(changed).toHaveBeenLastCalledWith({ supported: true, devices: [], selected: defaultOutput });
});

it('treats a missing native choice as not ready until an available match is discovered', async () => {
  const { preferences, discover } = harness(headphones);
  expect(preferences.ready()).toBe(false);
  discover.mockResolvedValueOnce({ supported: true, devices: [{ choice: headphones, label: 'Headphones', available: false }] });
  await preferences.refresh();
  expect(preferences.ready()).toBe(false);
  await preferences.refresh();
  expect(preferences.ready()).toBe(true);
});
