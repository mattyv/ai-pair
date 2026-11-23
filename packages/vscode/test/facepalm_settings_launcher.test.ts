import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openFacepalmSettings } from '../src/facepalm_settings_launcher';

const fakes = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn(), stat: vi.fn(), homedir: vi.fn(() => '/home/user') }));
vi.mock('node:child_process', () => ({ spawn: fakes.spawn }));
vi.mock('node:fs/promises', () => ({ access: fakes.access, stat: fakes.stat }));
vi.mock('node:os', () => ({ homedir: fakes.homedir }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Facepalm settings launcher', () => {
  it('does not launch a remote GUI', async () => {
    await expect(openFacepalmSettings('linux', true)).resolves.toBe(false);
    expect(fakes.spawn).not.toHaveBeenCalled();
  });
  it('settles on spawn without waiting for the menu to exit', async () => {
    fakes.access.mockResolvedValue(undefined);
    fakes.stat.mockResolvedValue({ isFile: () => true });
    // node:child_process uses EventEmitter.
    // oxlint-disable-next-line unicorn/prefer-event-target
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    await expect(result).resolves.toBe(true);
    expect(fakes.spawn).toHaveBeenCalledWith('/usr/bin/facepalm-menu', ['--settings'], { detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
  });
  it('waits for the macOS open command to accept the app', async () => {
    fakes.access.mockResolvedValue(undefined);
    fakes.stat.mockResolvedValue({ isFile: () => true });
    // node:child_process uses EventEmitter.
    // oxlint-disable-next-line unicorn/prefer-event-target
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('darwin', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('spawn');
    child.emit('close', 1);
    await expect(result).resolves.toBe(false);
    expect(fakes.spawn).toHaveBeenCalledWith('/usr/bin/open', ['/home/user/Applications/Facepalm.app', '--args', '--settings'], {
      detached: true,
      stdio: 'ignore',
    });
  });
  it('kills an unacknowledged launcher at the deadline', async () => {
    vi.useFakeTimers();
    fakes.access.mockResolvedValue(undefined);
    fakes.stat.mockResolvedValue({ isFile: () => true });
    // node:child_process uses EventEmitter.
    // oxlint-disable-next-line unicorn/prefer-event-target
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(false);
    expect(child.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('rejects unsupported, missing, and non-file menu paths', async () => {
    await expect(openFacepalmSettings('win32', false)).resolves.toBe(false);
    fakes.stat.mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce({ isFile: () => false });
    await expect(openFacepalmSettings('linux', false)).resolves.toBe(false);
    expect(fakes.spawn).not.toHaveBeenCalled();
  });
  it('reports a synchronous spawn failure', async () => {
    fakes.stat.mockResolvedValue({ isFile: () => true });
    fakes.access.mockResolvedValue(undefined);
    fakes.spawn.mockImplementation(() => {
      throw new Error('failed');
    });
    await expect(openFacepalmSettings('linux', false)).resolves.toBe(false);
  });
  it('reports an asynchronous spawn failure', async () => {
    fakes.stat.mockResolvedValue({ isFile: () => true });
    fakes.access.mockResolvedValue(undefined);
    // node:child_process uses EventEmitter.
    // oxlint-disable-next-line unicorn/prefer-event-target
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('linux', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('error', new Error('failed'));
    await expect(result).resolves.toBe(false);
  });
  it('accepts a successful macOS open command', async () => {
    fakes.stat.mockResolvedValue({ isFile: () => true });
    fakes.access.mockResolvedValue(undefined);
    // node:child_process uses EventEmitter.
    // oxlint-disable-next-line unicorn/prefer-event-target
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    fakes.spawn.mockReturnValue(child);
    const result = openFacepalmSettings('darwin', false);
    await vi.waitFor(() => {
      expect(fakes.spawn).toHaveBeenCalled();
    });
    child.emit('close', 0);
    await expect(result).resolves.toBe(true);
  });
});
