import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPlacement } from '../src/panel_placement';

afterEach(() => {
  vi.useRealTimers();
});

describe('panel placement', () => {
  it('allows slow activation its own bounded interval before preparing', async () => {
    vi.useFakeTimers();
    const activation = Promise.withResolvers<unknown>();
    const prepare = vi.fn().mockResolvedValue({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      epoch: 'epoch',
      token: 'token',
      extension: '0.47.0',
    });
    const commit = vi.fn().mockResolvedValue(true);
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      activationTimeoutMs: 500,
      activate: () => activation.promise,
      prepare,
      commit,
    });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(200);
    expect(prepare).not.toHaveBeenCalled();
    activation.resolve(true);
    expect(await result).toBe('companion');
    expect(commit).toHaveBeenCalledOnce();
  });

  it('ignores activation completing after its deadline', async () => {
    vi.useFakeTimers();
    const activation = Promise.withResolvers<unknown>();
    const prepare = vi.fn();
    const commit = vi.fn();
    const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      activationTimeoutMs: 500,
      activate: () => activation.promise,
      prepare,
      commit,
      failure,
    });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe('incompatible');
    expect(failure).toHaveBeenCalledExactlyOnceWith('activation_timeout');
    activation.resolve(true);
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects an invalid readiness response without preparing', async () => {
    const prepare = vi.fn();
    const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: true,
      companionInstalled: true,
      timeoutMs: 100,
      activate: () => Promise.resolve(undefined),
      prepare,
      commit: vi.fn(),
      failure,
    });
    expect(await placement.choose()).toBe('incompatible');
    expect(failure).toHaveBeenCalledExactlyOnceWith('activation_failure');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('reports activation rejection without preparing', async () => {
    const prepare = vi.fn();
    const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      companionInstalled: true,
      timeoutMs: 100,
      activate: () => Promise.reject(new Error('private')),
      prepare,
      commit: vi.fn(),
      failure,
    });
    expect(await placement.choose()).toBe('incompatible');
    expect(failure).toHaveBeenCalledExactlyOnceWith('activation_failure');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('chooses companion irrevocably before committing, including on a lost acknowledgement', async () => {
    const prepare = vi.fn().mockResolvedValue({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      epoch: 'epoch',
      token: 'token',
      extension: '0.47.0',
    });
    const commit = vi.fn().mockRejectedValue(new Error('lost'));
    const placement = new PanelPlacement({ epoch: 'epoch', remote: false, timeoutMs: 100, prepare, commit });
    expect(await placement.choose()).toBe('companion');
    expect(await placement.choose()).toBe('companion');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' });
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
    pending.resolve({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'late', extension: '0.47.0' });
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(await placement.choose()).toBe('remote-text');
  });

  it('uses local legacy only for a failed or invalid preparation before commit', async () => {
    for (const reply of [
      undefined,
      { version: LOCAL_AUDIO_VERSION - 1, epoch: 'epoch', token: 'token', extension: '0.47.0' },
      { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'wrong', token: 'token', extension: '0.47.0' },
    ]) {
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
      [
        () => Promise.resolve({ version: LOCAL_AUDIO_VERSION - 1, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
        'protocol_mismatch',
      ],
      [() => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'wrong', token: 'token', extension: '0.47.0' }), 'epoch_mismatch'],
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
    pending.resolve({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' });
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
  });

  it('installs workspace receivers before the companion may register the provider', async () => {
    const order: string[] = [];
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
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
  it('NoEarlyMissing: in a remote window, asks again for a companion not yet registered, and uses it once it answers (#115)', async () => {
    vi.useFakeTimers();
    const activate = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('command not found'))
      .mockRejectedValueOnce(new Error('command not found'))
      .mockResolvedValue(true);
    const prepared = vi.fn<(extension: string) => void>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: true,
      timeoutMs: 100,
      activationTimeoutMs: 10_000,
      retryMs: 50,
      activate,
      prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
      prepared,
      commit: () => Promise.resolve(true),
    });
    const result = placement.choose();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe('companion');
    expect(activate).toHaveBeenCalledTimes(3);
    expect(prepared).toHaveBeenCalledExactlyOnceWith('0.47.0');
  });

  it('NoEarlyMissing: reports a remote companion missing only once the deadline passes (#115)', async () => {
    vi.useFakeTimers();
    const activate = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('command not found'));
    const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
    const prepare = vi.fn();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: true,
      timeoutMs: 100,
      activationTimeoutMs: 1000,
      activate,
      prepare,
      failure,
      commit: vi.fn(),
    });
    let settled = false;
    const result = placement.choose().then((owner) => {
      settled = true;
      return owner;
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toBe(false);
    // The default wait between attempts: 250 ms.
    expect(activate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe('remote-text');
    expect(failure).toHaveBeenCalledExactlyOnceWith('not_found');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('NoMissingOnceReached: a remote companion that answered and then failed is not reported missing (#115)', async () => {
    vi.useFakeTimers();
    for (const [activate, prepare, reason] of [
      [() => Promise.resolve(true), () => new Promise<unknown>(() => {}), 'timeout'],
      [() => new Promise<unknown>(() => {}), vi.fn(), 'activation_timeout'],
      [() => Promise.resolve(false), vi.fn(), 'activation_failure'],
    ] as const) {
      const failure = vi.fn<(reason: import('../src/panel_placement').PanelPrepareFailure) => void>();
      const placement = new PanelPlacement({
        epoch: 'epoch',
        remote: true,
        timeoutMs: 100,
        activationTimeoutMs: 500,
        activate,
        prepare,
        failure,
        commit: vi.fn(),
      });
      const result = placement.choose();
      await vi.advanceTimersByTimeAsync(600);
      expect(await result).toBe('incompatible');
      expect(failure).toHaveBeenCalledExactlyOnceWith(reason);
    }
  });

  it('never chooses legacy if local initialization fails after selection', async () => {
    const commit = vi.fn<(_: import('@ai-pair/protocol').LocalAudioPrepared) => Promise<unknown>>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
      beforeCommit: () => {
        throw new Error('failed');
      },
      commit,
    });
    expect(await placement.choose()).toBe('companion');
    expect(commit).not.toHaveBeenCalled();
  });
});

it('waits for a successful commit acknowledgement before creating the session', async () => {
  const commit = Promise.withResolvers<unknown>();
  const beforeCommit = vi.fn<() => void>();
  const afterCommit = vi.fn<() => void>();
  const placement = new PanelPlacement({
    epoch: 'epoch',
    remote: false,
    // Long enough that a slow runner cannot reach the deadline: this case is not about it.
    timeoutMs: 60_000,
    prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
    beforeCommit,
    afterCommit,
    commit: () => commit.promise,
  });
  const selected = placement.choose();
  await vi.waitFor(() => {
    expect(beforeCommit).toHaveBeenCalledOnce();
  });
  expect(afterCommit).not.toHaveBeenCalled();
  commit.resolve(true);
  expect(await selected).toBe('companion');
  expect(afterCommit).toHaveBeenCalledOnce();
});

it('keeps companion ownership after rejected, false, or timed out commit without starting a session', async () => {
  vi.useFakeTimers();
  for (const result of [Promise.reject(new Error('private')), Promise.resolve(false)]) {
    const afterCommit = vi.fn<() => void>();
    const placement = new PanelPlacement({
      epoch: 'epoch',
      remote: false,
      timeoutMs: 100,
      prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
      afterCommit,
      commit: () => result,
    });
    expect(await placement.choose()).toBe('companion');
    expect(afterCommit).not.toHaveBeenCalled();
  }
  const pending = Promise.withResolvers<unknown>();
  const afterCommit = vi.fn<() => void>();
  const placement = new PanelPlacement({
    epoch: 'epoch',
    remote: false,
    timeoutMs: 100,
    prepare: () => Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token', extension: '0.47.0' }),
    afterCommit,
    commit: () => pending.promise,
  });
  const selected = placement.choose();
  await vi.advanceTimersByTimeAsync(100);
  expect(await selected).toBe('companion');
  pending.resolve(true);
  await Promise.resolve();
  expect(afterCommit).not.toHaveBeenCalled();
});
