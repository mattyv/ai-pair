import * as path from 'node:path';

/** Group and other write permissions disqualify a system path. */
const UNTRUSTED_WRITE_BITS = 0o022;
/** Matches Linux's bound on symlink resolution. */
const MAX_SYMLINK_HOPS = 40;

/** File metadata required to verify a system-owned path. */
export interface SystemPathStat {
  uid: number;
  mode: number;
  symlink: boolean;
}

/** Filesystem operations used to inspect every component and symlink hop. */
export interface SystemPathAccess {
  readlink: (value: string) => Promise<string>;
  lstat: (value: string) => Promise<SystemPathStat>;
}

/** Rejects any non-root-owned or writable component of a system path's resolution. */
export async function trustedSystemPath(value: string, fs: SystemPathAccess): Promise<boolean> {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) return false;
  const pending = value.split('/').filter((part) => part !== '');
  let current = '/';
  let links = 0;
  try {
    const root = await fs.lstat(current);
    if (root.uid !== 0 || root.symlink || (root.mode & UNTRUSTED_WRITE_BITS) !== 0) return false;
    while (pending.length > 0) {
      const part = pending.shift();
      if (part === undefined || part === '' || part === '.') continue;
      if (part === '..') {
        current = path.dirname(current);
        continue;
      }
      const next = path.join(current, part);
      const info = await fs.lstat(next);
      if (info.uid !== 0 || (!info.symlink && (info.mode & UNTRUSTED_WRITE_BITS) !== 0)) return false;
      if (!info.symlink) {
        current = next;
        continue;
      }
      if (++links > MAX_SYMLINK_HOPS) return false;
      const target = await fs.readlink(next);
      if (target === '') return false;
      if (path.isAbsolute(target)) current = '/';
      pending.unshift(...target.split('/'));
    }
    return true;
  } catch {
    return false;
  }
}
