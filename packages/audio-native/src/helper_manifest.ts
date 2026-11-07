import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { helperFilename } from './helper_location';

const MAX_MANIFEST = 8192;
const MAX_BINARY = 33_554_432;
const HASH = /^[0-9a-f]{64}$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resolves a fixed package asset only when its bounded manifest and digest match. */
export async function resolveBundledHelper(root: string, platform: string, architecture: string): Promise<string | undefined> {
  const name = helperFilename(platform, architecture);
  if (!isAbsolute(root) || name === undefined) return undefined;
  const directory = join(root, 'dist', 'audio-native');
  const manifestPath = join(directory, 'manifest.json');
  const binaryPath = join(directory, name);
  try {
    const [manifestStat, binaryStat] = await Promise.all([lstat(manifestPath), lstat(binaryPath)]);
    if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST || !binaryStat.isFile() || binaryStat.size > MAX_BINARY) {
      return undefined;
    }
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!record(manifest) || manifest.version !== 1 || !record(manifest.sha256)) return undefined;
    const expected = manifest.sha256[name];
    if (typeof expected !== 'string' || !HASH.test(expected)) return undefined;
    const digest = createHash('sha256')
      .update(await readFile(binaryPath))
      .digest('hex');
    return digest === expected ? binaryPath : undefined;
  } catch {
    return undefined;
  }
}
