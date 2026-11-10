import { expect, it, vi } from 'vitest';
import { AttachmentGate } from '../../audio-ui/src/attachment_gate';
import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { PanelPlacement } from '../src/panel_placement';

it('keeps an installed incompatible companion unattached without fallback', async () => {
  const register = vi.fn<() => void>();
  const gate = new AttachmentGate({ token: () => 'token', timeoutMs: 100, register });
  const commit = vi.fn((value: unknown) => Promise.resolve(gate.commit(value)));
  const placement = new PanelPlacement({
    epoch: 'epoch',
    remote: false,
    companionInstalled: true,
    timeoutMs: 100,
    // Emulate the old companion refusing a version it does not understand.
    prepare: () => Promise.resolve(gate.prepare({ version: LOCAL_AUDIO_VERSION - 1, epoch: 'epoch' })),
    commit,
  });
  expect(await placement.choose()).toBe('incompatible');
  expect(commit).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  gate.dispose();
});

it('attaches matching workspace and companion versions once', async () => {
  const register = vi.fn<() => void>();
  const gate = new AttachmentGate({ token: () => 'token', timeoutMs: 100, register });
  const commit = vi.fn((value: unknown) => Promise.resolve(gate.commit(value)));
  const placement = new PanelPlacement({
    epoch: 'epoch',
    remote: false,
    companionInstalled: true,
    timeoutMs: 100,
    prepare: () => Promise.resolve(gate.prepare({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch' })),
    commit,
  });
  expect(await placement.choose()).toBe('companion');
  await vi.waitFor(() => {
    expect(register).toHaveBeenCalledOnce();
  });
  expect(commit).toHaveBeenCalledOnce();
  gate.dispose();
});

it('waits for delayed activation before preparing and committing the gate', async () => {
  vi.useFakeTimers();
  const activation = Promise.withResolvers<unknown>();
  const register = vi.fn<() => void>();
  const gate = new AttachmentGate({ token: () => 'token', timeoutMs: 500, register });
  try {
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      activationTimeoutMs: 500,
      activate: () => activation.promise,
      prepare: () => Promise.resolve(gate.prepare({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch' })),
      commit: (value) => Promise.resolve(gate.commit(value)),
    });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(200);
    expect(register).not.toHaveBeenCalled();
    activation.resolve(true);
    expect(await result).toBe('companion');
    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledOnce();
    });
  } finally {
    gate.dispose();
    vi.useRealTimers();
  }
});
