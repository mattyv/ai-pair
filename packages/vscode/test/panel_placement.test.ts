import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPlacement } from '../src/panel_placement';

afterEach(() => {
  vi.useRealTimers();
});

describe('panel placement', () => {
  it('chooses companion irrevocably before committing, including on a lost acknowledgement', async () => {
    const prepare = vi.fn().mockResolvedValue({ version: 2, epoch: 'epoch', token: 'token' });
    const commit = vi.fn().mockRejectedValue(new Error('lost'));
    const placement = new PanelPlacement({ epoch: 'epoch', remote: false, timeoutMs: 100, prepare, commit });
    expect(await placement.choose()).toBe('companion');
    expect(await placement.choose()).toBe('companion');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ version: 2, epoch: 'epoch', token: 'token' });
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
    pending.resolve({ version: 2, epoch: 'epoch', token: 'late' });
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(await placement.choose()).toBe('remote-text');
  });

  it('uses local legacy only for a failed or invalid preparation before commit', async () => {
    for (const reply of [undefined, { version: 1, epoch: 'epoch', token: 'token' }, { version: 2, epoch: 'wrong', token: 'token' }]) {
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
  it('rejects an installed incompatible companion before selecting any panel owner', async () => {
    const commit = vi.fn();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      prepare: () => Promise.resolve(undefined),
      commit,
    });
    expect(await placement.choose()).toBe('incompatible');
    expect(commit).not.toHaveBeenCalled();
  });

  it('reports sanitized preparation failure categories without committing', async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [() => Promise.reject(new Error('private path')), 'activation_failure'],
      [() => Promise.resolve({ version: 1, epoch: 'epoch', token: 'token' }), 'protocol_mismatch'],
      [() => Promise.resolve({ version: 2, epoch: 'wrong', token: 'token' }), 'epoch_mismatch'],
      [() => Promise.resolve({ unexpected: true }), 'invalid_response'],
    ];
    for (const [prepare, reason] of cases) {
      const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
      const commit = vi.fn();
      const placement = new PanelPlacement({
        epoch: 'epoch',
        remote: false,
        companionInstalled: true,
        timeoutMs: 100,
        prepare,
        commit,
        failure,
      });
      expect(await placement.choose()).toBe('incompatible');
      expect(failure).toHaveBeenCalledExactlyOnceWith(reason);
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('reports timeout without committing a late response', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<unknown>();
    const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
    const commit = vi.fn();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      prepare: () => pending.promise,
      commit,
      failure,
    });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe('incompatible');
    expect(failure).toHaveBeenCalledExactlyOnceWith('timeout');
    pending.resolve({ version: 2, epoch: 'epoch', token: 'token' });
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
  });

  it('installs workspace receivers before the companion may register the provider', async () => {
    const order: string[] = [];
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: 2, epoch: 'epoch', token: 'token' }),
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
      prepare: () => Promise.resolve({ version: 2, epoch: 'epoch', token: 'token' }),
      beforeCommit: () => {
        throw new Error('failed');
      },
      commit,
    });
    expect(await placement.choose()).toBe('companion');
    expect(commit).not.toHaveBeenCalled();
  });
});
