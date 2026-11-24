import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const SPAWN_TIMEOUT_MS = 2000;

/** Opens the installed Facepalm settings UI only on this local host. */
export async function openFacepalmSettings(platform: NodeJS.Platform, remote: boolean): Promise<boolean> {
  if (remote) return false;
  const candidates =
    platform === 'darwin'
      ? [path.join(os.homedir(), 'Applications', 'Facepalm.app')]
      : platform === 'linux'
        ? ['/usr/bin/facepalm-menu', path.join(os.homedir(), '.local', 'facepalm', 'bin', 'facepalm-menu')]
        : [];
  for (const candidate of candidates) {
    try {
      const executable = platform === 'darwin' ? path.join(candidate, 'Contents', 'MacOS', 'facepalm-menu') : candidate;
      if (!(await fs.stat(executable)).isFile()) continue;
      await fs.access(executable, constants.X_OK);
    } catch {
      continue;
    }
    const command = platform === 'darwin' ? '/usr/bin/open' : candidate;
    const args = platform === 'darwin' ? [candidate, '--args', '--settings'] : ['--settings'];
    return new Promise((resolve) => {
      try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        const timer = setTimeout(() => {
          child.kill();
          resolve(false);
        }, SPAWN_TIMEOUT_MS);
        child.once('spawn', () => {
          if (platform === 'darwin') return;
          clearTimeout(timer);
          child.unref();
          resolve(true);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          resolve(platform === 'darwin' && code === 0);
        });
        child.once('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }
  return false;
}
