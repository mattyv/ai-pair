import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openFacepalmSettings } from '../src/facepalm_settings_launcher';

const fake = vi.hoisted(() => ({
  script: '',
  children: [] as Array<import('node:child_process').ChildProcess>,
}));
vi.mock('node:fs/promises', () => ({ stat: () => Promise.resolve({ isFile: () => true }), access: () => Promise.resolve() }));
vi.mock('node:os', () => ({ homedir: () => '/isolated' }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    spawn: (command: string, args: string[], options: import('node:child_process').SpawnOptions) => {
      expect(command).toBe('/usr/bin/facepalm-menu');
      expect(args).toEqual(['--settings']);
      const child = actual.spawn(process.execPath, ['-e', fake.script], options);
      fake.children.push(child);
      return child;
    },
  };
});

beforeEach(() => {
  fake.children = [];
});
afterEach(async () => {
  for (const child of fake.children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve();
      });
    });
    child.kill();
    await closed;
  }
});

it('reports a real child process failing immediately after spawn', async () => {
  fake.script = "process.stderr.write('qt.qpa.xcb: could not connect to display /private\\n', () => process.exit(7));";
  await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'failed', reason: 'display' });
});

it('classifies a real unacknowledged tray handoff', async () => {
  fake.script =
    "process.stderr.write('facepalm-menu: settings request was not acknowledged by the running tray\\n', () => process.exit(1));";
  await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'failed', reason: 'handoff' });
});

it('accepts a real cleanly exiting forwarder', async () => {
  fake.script = 'process.exit(0);';
  await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'accepted' });
});

it('accepts a real menu that remains alive through the observation period', async () => {
  fake.script = 'setTimeout(() => process.exit(0), 10000);';
  await expect(openFacepalmSettings('linux', false)).resolves.toEqual({ state: 'accepted' });
});
