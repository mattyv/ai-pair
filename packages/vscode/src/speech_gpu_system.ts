import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { findGpuDriver, type TrustedGpuDriver } from './speech_gpu_driver';
import { trustedGpuLoader, type TrustedGpuLoader } from './speech_gpu_loader_allowlist';
import { trustedSystemPath } from './speech_gpu_trust';

const MAX_LOADER_BYTES = 16_777_216;
const MAX_DRIVER_BYTES = 268_435_456;

const MAX_MANIFEST_BYTES = 65_536;

/** Checks every system path component and resolved symlink target. */
function trustedPath(file: string): Promise<boolean> {
  return trustedSystemPath(file, {
    readlink,
    lstat: async (name) => {
      const info = await lstat(name);
      return { uid: info.uid, mode: info.mode, symlink: info.isSymbolicLink() };
    },
  });
}

/** Finds an allowlisted Vulkan loader with a trusted system-owned path. */
export function systemGpuLoader(): Promise<TrustedGpuLoader | undefined> {
  return trustedGpuLoader({
    realpath,
    trusted: trustedPath,
    hash: async (file) => {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_LOADER_BYTES) throw new Error('Invalid Vulkan loader.');
      return createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    },
  });
}

/** Finds a trusted system Radeon ICD without inheriting user-selected drivers. */
export function systemGpuDriver(): Promise<TrustedGpuDriver | undefined> {
  return findGpuDriver({
    trusted: trustedPath,
    realpath,
    identity: async (file) => {
      const before = await stat(file, { bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_DRIVER_BYTES)) throw new Error('Invalid Radeon driver.');
      const sha256 = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
      const after = await stat(file, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) throw new Error('Radeon driver changed.');
      return { path: file, sha256, device: before.dev.toString(), inode: before.ino.toString() };
    },
    read: async (file) => {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new Error('Invalid Vulkan manifest.');
      return (await readFile(file)).toString('utf8');
    },
  });
}
