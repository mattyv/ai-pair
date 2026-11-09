import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

/** Maximum size of a loader accepted for the bounded content check. */
const MAX_LOADER_BYTES = 16_777_216;
/** Linux device-number bit fields. */
const BYTE_MASK = 0xffn;
const MINOR_HIGH_MASK = 0xffffff00n;
const MAJOR_LOW_MASK = 0xfffn;
const MAJOR_HIGH_MASK = 0xfffff000n;
const EIGHT_BITS = 8n;
const TWELVE_BITS = 12n;
const THIRTY_TWO_BITS = 32n;

/** Operations used to check the child process's mapped loader. */
export interface LoaderAccess {
  maps: () => Promise<string>;
  stat: (file: string) => Promise<{ device: bigint; inode: bigint }>;
  read: (file: string) => Promise<Uint8Array>;
}

const systemAccess: LoaderAccess = {
  maps: () => readFile('/proc/self/maps', 'utf8'),
  stat: async (file) => {
    const info = await stat(file, { bigint: true });
    if (!info.isFile() || info.size > BigInt(MAX_LOADER_BYTES)) throw new Error('Invalid loader');
    return { device: info.dev, inode: info.ino };
  },
  read: (file) => readFile(file),
};

/** Confirms the pinned loader is the only Vulkan loader mapped into this child. */
export async function verifyMappedVulkanLoader(
  expectedPath: string,
  expectedSha256: string,
  access: LoaderAccess = systemAccess,
): Promise<boolean> {
  if (!path.isAbsolute(expectedPath) || path.normalize(expectedPath) !== expectedPath || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return false;
  }
  try {
    const maps = await access.maps();
    const candidates = new Set<string>();
    for (const line of maps.split('\n')) {
      const match = /^\S+\s+\S+\s+\S+\s+([\da-f]+):([\da-f]+)\s+(\d+)\s+(\/.*)$/.exec(line);
      if (match === null) continue;
      const [, major, minor, inode, file] = match;
      if (file === undefined || !/\/libvulkan\.so(?:\.\d+)*(?: \(deleted\))?$/.test(file)) continue;
      if (major === undefined || minor === undefined || inode === undefined || file !== expectedPath) return false;
      candidates.add(`${major}:${minor}:${inode}`);
    }
    if (candidates.size !== 1) return false;
    const id = [...candidates][0];
    if (id === undefined) return false;
    const [major, minor, inode] = id.split(':');
    if (major === undefined || minor === undefined || inode === undefined) return false;
    const actual = await access.stat(expectedPath);
    const deviceMajor = ((actual.device >> EIGHT_BITS) & MAJOR_LOW_MASK) | ((actual.device >> THIRTY_TWO_BITS) & MAJOR_HIGH_MASK);
    const deviceMinor = (actual.device & BYTE_MASK) | ((actual.device >> TWELVE_BITS) & MINOR_HIGH_MASK);
    if (deviceMajor !== BigInt(`0x${major}`) || deviceMinor !== BigInt(`0x${minor}`) || actual.inode !== BigInt(inode)) return false;
    return (
      createHash('sha256')
        .update(await access.read(expectedPath))
        .digest('hex') === expectedSha256
    );
  } catch {
    return false;
  }
}
