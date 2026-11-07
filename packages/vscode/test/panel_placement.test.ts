import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPlacement } from '../src/panel_placement';

afterEach(() => {
  vi.useRealTimers();
});

describe('panel placement', () => {
  it('chooses companion irrevocably before committing, including on a lost acknowledgement', async () => {
    const prepare = vi.fn().mockResolvedValue({ version: 1, epoch: 'epoch', token: 'token' });
    const commit = vi.fn().mockRejectedValue(new Error('lost'));
    const placement = new PanelPlacement({ epoch: 'epoch', remote: false, timeoutMs: 100, prepare, commit });
    expect(await placement.choose()).toBe('companion');
    expect(await placement.choose()).toBe('companion');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ version: 1, epoch: 'epoch', token: 'token' });
  });

  it('falls back only before commit and ignores late prepare replies', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<unknown>();
    const prepare = vi.fn(() => pending.promise);
    const commit = vi.fn();
    const placement = new PanelPlacement({ epoch: 'epoch', remote: true, timeoutMs: 100, prepare, commit });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe('remote-text');
    pending.resolve({ version: 1, epoch: 'epoch', token: 'late' });
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(await placement.choose()).toBe('remote-text');
  });

  it('uses local legacy only for a failed or invalid preparation before commit', async () => {
    for (const reply of [undefined, { version: 2, epoch: 'epoch', token: 'token' }, { version: 1, epoch: 'wrong', token: 'token' }]) {
      const commit = vi.fn();
      const placement = new PanelPlacement({
        epoch: 'epoch',
        remote: false,
        timeoutMs: 100,
        prepare: () => Promise.resolve(reply),
        commit,
      });
      expect(await placement.choose()).toBe('legacy');
      expect(commit).not.toHaveBeenCalled();
    }
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.reject(new Error('missing')),
      commit: vi.fn(),
    });
    expect(await placement.choose()).toBe('legacy');
  });
  it('installs workspace receivers before the companion may register the provider', async () => {
    const order: string[] = [];
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: 1, epoch: 'epoch', token: 'token' }),
      beforeCommit: () => {
        order.push('ready');
      },
      commit: () => {
        order.push('commit');
        return Promise.resolve();
      },
    });
    expect(await placement.choose()).toBe('companion');
    expect(order).toEqual(['ready', 'commit']);
  });
  it('never chooses legacy if local initialization fails after selection', async () => {
    const commit = vi.fn<(_: import('@ai-pair/protocol').LocalAudioPrepared) => Promise<unknown>>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: 1, epoch: 'epoch', token: 'token' }),
      beforeCommit: () => {
        throw new Error('failed');
      },
      commit,
    });
    expect(await placement.choose()).toBe('companion');
    expect(commit).not.toHaveBeenCalled();
  });
});
