import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facepalmSettingsWarning, openFacepalmSettings } from '../src/facepalm_settings_launcher';

const fakes = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn(), stat: vi.fn(), homedir: vi.fn(() => '/home/user') }));
vi.mock('node:child_process', () => ({ spawn: fakes.spawn }));
vi.mock('node:fs/promises', () => ({ access: fakes.access, stat: fakes.stat }));
vi.mock('node:os', () => ({ homedir: fakes.homedir }));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Builds the process and stderr events supplied by Node. */
function childProcess() {
  // Node's child-process and stream APIs use EventEmitter.
  // oxlint-disable-next-line unicorn/prefer-event-target
  const stderr = Object.assign(new EventEmitter(), { unref: vi.fn() });
  // oxlint-disable-next-line unicorn/prefer-event-target
  return Object.assign(new EventEmitter(), { stderr, unref: vi.fn(), kill: vi.fn() });
}

/** Makes an installed menu reachable to the launcher. */
function installed(): void {
  fakes.access.mockResolvedValue(undefined);
  fakes.stat.mockResolvedValue({ isFile: () => true });
}

describe('Facepalm settings launcher', () => {
  it('refuses a remote GUI or unavailable menu', async () => {
    await expect(openFacepalmSettings('linux', true)).resolves.toEqual({ state: 'failed', reason: 'unavailable' });
    await expect(openFacepalmSettings('win32', false)).resolves.toEqual({ state: 'failed', reason: 'unavailable' });
    fakes.stat.mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce({ isFile: () => false });
    await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'failed', reason: 'unavailable' });
    expect(fakes.spawn).not.toHaveBeenCalled();
  });
  it('AcceptedEvidence: accepts a still-running Linux menu only after the grace period', async () => {
    vi.useFakeTimers();
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    let settled = false;
    const result = openFacepalmSettings('linux', false).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);
    child.emit('spawn');
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ state: 'accepted' });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.stderr.unref).toHaveBeenCalledOnce();
    expect(fakes.spawn).toHaveBeenCalledWith('/usr/bin/facepalm-menu', ['--settings'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.emit('close', 1);
  });
  it('reports a late nonzero exit without exposing raw stderr', async () => {
    vi.useFakeTimers();
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    const late = vi.fn<(failure: Extract<import('@ai-pair/protocol').FacepalmSettingsLaunch, { state: 'failed' }>) => void>();
    const result = openFacepalmSettings('linux', false, late);
    await vi.advanceTimersByTimeAsync(0);
    child.emit('spawn');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ state: 'accepted' });
    child.stderr.emit('data', Buffer.from('Could not load Qt platform plugin /secret'));
    child.emit('close', 1);
    expect(late).toHaveBeenCalledWith({ state: 'failed', reason: 'qt' });
  });

  it('accepts a cleanly exiting Linux forwarder', async () => {
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ state: 'accepted' });
  });
  it('reports an early Qt display failure after spawn without exposing stderr', async () => {
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    child.stderr.emit('data', Buffer.from('qt.qpa.xcb: could not connect to display /secret/path TOKEN=abc'));
    child.emit('close', 1);
    const failure = await result;
    expect(failure).toEqual({ state: 'failed', reason: 'display' });
    if (failure.state !== 'failed') throw new Error('Expected failure');
    expect(facepalmSettingsWarning(failure)).not.toContain('TOKEN');
  });
  it('contains repeated process events and a missing diagnostic pipe', async () => {
    installed();
    const child = childProcess();
    // Node represents an unavailable stdio pipe as null.
    // oxlint-disable-next-line unicorn/no-null
    Object.defineProperty(child, 'stderr', { value: null });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false, () => {
      throw new Error('observer');
    });
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ state: 'accepted' });
    child.emit('error', new Error('late'));
  });

  it('classifies a Qt plugin error and a nonzero menu exit', async () => {
    installed();
    const first = childProcess();
    const second = childProcess();
    fakes.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(1);
    });
    first.emit('spawn');
    first.stderr.emit('data', Buffer.from('Could not load the Qt platform plugin'));
    first.emit('close', 1);
    await expect(one).resolves.toEqual({ state: 'failed', reason: 'qt' });
    const two = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(2);
    });
    second.emit('spawn');
    second.emit('close', 42);
    await expect(two).resolves.toEqual({ state: 'failed', reason: 'exit', code: 42 });
  });
  it('bounds diagnostics, handles a signalled exit, and accepts without an unref-capable stream', async () => {
    installed();
    const first = childProcess();
    const second = childProcess();
    Object.defineProperty(second.stderr, 'unref', { value: undefined });
    fakes.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(1);
    });
    first.emit('spawn');
    first.stderr.emit('data', Buffer.from('x'.repeat(4096)));
    first.stderr.emit('data', Buffer.from('could not connect to display /secret'));
    // Node's close event uses null when terminated by a signal.
    // oxlint-disable-next-line unicorn/no-null
    first.emit('close', null);
    await expect(one).resolves.toEqual({ state: 'failed', reason: 'exit' });
    const two = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(2);
    });
    second.emit('spawn');
    second.emit('close', 0);
    await expect(two).resolves.toEqual({ state: 'accepted' });
  });

  it('recognizes an unacknowledged tray request without exposing raw stderr', async () => {
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    child.stderr.emit('data', Buffer.from('facepalm-menu: settings request was not acknowledged by the running tray'));
    child.emit('close', 1);
    await expect(result).resolves.toEqual({ state: 'failed', reason: 'handoff' });
  });

  it('waits for the macOS open command and reports its result', async () => {
    installed();
    const first = childProcess();
    const second = childProcess();
    fakes.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = openFacepalmSettings('darwin', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(1);
    });
    first.emit('spawn');
    first.emit('close', 1);
    await expect(one).resolves.toEqual({ state: 'failed', reason: 'exit', code: 1 });
    expect(fakes.spawn).toHaveBeenCalledWith('/usr/bin/open', ['/home/user/Applications/Facepalm.app', '--args', '--settings'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const two = openFacepalmSettings('darwin', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(2);
    });
    second.emit('close', 0);
    await expect(two).resolves.toEqual({ state: 'accepted' });
  });
  it('Settles: kills an unacknowledged process at the deadline', async () => {
    vi.useFakeTimers();
    installed();
    const child = childProcess();
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ state: 'failed', reason: 'timeout' });
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('Settles: a failed timeout kill still reports the timeout', async () => {
    vi.useFakeTimers();
    installed();
    const child = childProcess();
    child.kill.mockImplementation(() => {
      throw new Error('private');
    });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ state: 'failed', reason: 'timeout' });
  });

  it('reports synchronous and asynchronous spawn errors', async () => {
    installed();
    fakes.spawn.mockImplementationOnce(() => {
      throw new Error('private');
    });
    await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'failed', reason: 'start' });
    const child = childProcess();
    fakes.spawn.mockReturnValueOnce(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalledTimes(2);
    });
    child.emit('error', new Error('private'));
    await expect(result).resolves.toEqual({ state: 'failed', reason: 'start' });
  });
  it('describes failure categories without raw diagnostics', () => {
    for (const reason of ['unavailable', 'start', 'timeout', 'display', 'qt', 'exit'] as const) {
      expect(facepalmSettingsWarning({ state: 'failed', reason })).toContain('Facepalm menu or tray');
    }
    expect(facepalmSettingsWarning({ state: 'failed', reason: 'exit', code: 42 })).toContain('42');
    expect(facepalmSettingsWarning({ state: 'failed', reason: 'inspection' }, 'recheck')).toContain('recheck Facepalm status');
  });
});
