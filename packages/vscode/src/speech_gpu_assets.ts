import { createHash } from 'node:crypto';
import * as path from 'node:path';

/** One exact relative asset path, size and SHA-256 from the runtime manifest. */
export interface GpuAsset {
  path: string;
  size: number;
  sha256: string;
}

/** Reads only a regular, non-symlink file no larger than the requested limit. */
export interface GpuAssetAccess {
  /** Lists every regular file relative to the root, rejecting symlinks and special files. */
  list: (directory: string) => Promise<string[]>;
  read: (file: string, limit: number) => Promise<Uint8Array>;
}

/** Verifies every pinned runtime asset before the isolated process can run. */
export async function verifyGpuAssets(directory: string, assets: readonly GpuAsset[], access: GpuAssetAccess): Promise<boolean> {
  if (!path.isAbsolute(directory) || assets.length === 0) return false;
  const names = new Set<string>();
  try {
    const files = await access.list(directory);
    const actual = new Set(files);
    if (actual.size !== files.length || actual.size !== assets.length || assets.some((asset) => !actual.has(asset.path))) return false;
    for (const asset of assets) {
      if (
        asset.path === '' ||
        path.isAbsolute(asset.path) ||
        path.normalize(asset.path) !== asset.path ||
        asset.path.split(path.sep).includes('..') ||
        names.has(asset.path) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)
      ) {
        return false;
      }
      names.add(asset.path);
      const bytes = await access.read(path.join(directory, asset.path), asset.size);
      if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}
