import * as path from 'node:path';

/** File metadata required to verify a system-owned path. */
export interface SystemPathStat {
  uid: number;
  mode: number;
  symlink: boolean;
}

/** Filesystem operations used to inspect the path and each symlink target. */
export interface SystemPathAccess {
  realpath: (value: string) => Promise<string>;
  lstat: (value: string) => Promise<SystemPathStat>;
}

/** Rejects non-root-owned or writable files, directories and symlink targets. */
export async function trustedSystemPath(value: string, fs: SystemPathAccess): Promise<boolean> {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) return false;
  const pending = [value];
  const checked = new Set<string>();
  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || checked.has(current)) continue;
      checked.add(current);
      const stat = await fs.lstat(current);
      if (stat.uid !== 0 || (!stat.symlink && (stat.mode & 0o022) !== 0)) return false;
      const resolved = await fs.realpath(current);
      if (!path.isAbsolute(resolved)) return false;
      if (!checked.has(resolved)) pending.push(resolved);
      const parent = path.dirname(current);
      if (parent !== current && !checked.has(parent)) pending.push(parent);
    }
    return true;
  } catch {
    return false;
  }
}
