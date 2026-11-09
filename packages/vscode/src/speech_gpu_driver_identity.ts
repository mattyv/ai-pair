import { hasGpuIcdExports } from './speech_gpu_elf';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

/** Immutable identity of a root-trusted Radeon driver file. */
export interface GpuDriverIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly device: string;
  readonly inode: string;
}

/** Operations used to inspect an isolated process's ICD mappings. */
export interface DriverIdentityAccess {
  maps: () => Promise<string>;
  stat: (file: string) => Promise<{ device: bigint; inode: bigint }>;
  read: (file: string) => Promise<Uint8Array>;
}

const MAX_MAPS_BYTES = 8_388_608;
const MAX_MAPPED_FILES = 4096;
const MAX_DRIVER_BYTES = 268_435_456;
const BYTE_MASK = 0xffn;
const MINOR_HIGH_MASK = 0xffffff00n;
const MAJOR_LOW_MASK = 0xfffn;
const MAJOR_HIGH_MASK = 0xfffff000n;
const EIGHT_BITS = 8n;
const TWELVE_BITS = 12n;
const THIRTY_TWO_BITS = 32n;
const systemAccess: DriverIdentityAccess = {
  maps: () => readFile('/proc/self/maps', 'utf8'),
  stat: async (file) => {
    const info = await stat(file, { bigint: true });
    if (!info.isFile() || info.size > BigInt(MAX_DRIVER_BYTES)) throw new Error('Invalid GPU driver.');
    return { device: info.dev, inode: info.ino };
  },
  read: (file) => readFile(file),
};

/** Reads every distinct executable file mapping, irrespective of its name. */
function driverMappings(maps: string): Array<{ major: string; minor: string; inode: string; file: string }> {
  if (maps.length > MAX_MAPS_BYTES) throw new Error('GPU maps too large.');
  const found = new Map<string, { major: string; minor: string; inode: string; file: string }>();
  for (const line of maps.split('\n')) {
    const match = /^\S+\s+(\S+)\s+\S+\s+([\da-f]+):([\da-f]+)\s+(\d+)\s+(\/.*)$/.exec(line);
    if (match === null || !String(match[1]).includes('x')) continue;
    const [, , major, minor, inode, file] = match;
    if (major === undefined || minor === undefined || inode === undefined || file === undefined || file.endsWith(' (deleted)')) throw new Error('Invalid GPU mapping.');
    const entry = { major, minor, inode, file };
    const old = found.get(file);
    if (old !== undefined && (old.major !== major || old.minor !== minor || old.inode !== inode)) throw new Error('Conflicting GPU mapping.');
    found.set(file, entry);
    if (found.size > MAX_MAPPED_FILES) throw new Error('Too many mapped files.');
  }
  return [...found.values()];
}

async function matchingMapping(entry: { major: string; minor: string; inode: string; file: string }, access: DriverIdentityAccess): Promise<boolean> {
  const actual = await access.stat(entry.file);
  const major = ((actual.device >> EIGHT_BITS) & MAJOR_LOW_MASK) | ((actual.device >> THIRTY_TWO_BITS) & MAJOR_HIGH_MASK);
  const minor = (actual.device & BYTE_MASK) | ((actual.device >> TWELVE_BITS) & MINOR_HIGH_MASK);
  return BigInt(`0x${entry.major}`) === major && BigInt(`0x${entry.minor}`) === minor && BigInt(entry.inode) === actual.inode;
}

/** Confirms the process maps only the exact, still-identical trusted Radeon ICD. */
export async function verifyMappedGpuDriver(identity: GpuDriverIdentity, loaderPath: string, access: DriverIdentityAccess = systemAccess): Promise<boolean> {
  if (!path.isAbsolute(identity.path) || path.normalize(identity.path) !== identity.path || !path.isAbsolute(loaderPath) ||
      !/^[a-f0-9]{64}$/.test(identity.sha256) || !/^\d+$/.test(identity.device) || !/^\d+$/.test(identity.inode)) return false;
  try {
    const mappings = driverMappings(await access.maps());
    let expected = false;
    for (const entry of mappings) {
      if (!(await matchingMapping(entry, access))) return false;
      if (entry.file === loaderPath) continue; // The caller independently verifies the exact loader first.
      if (entry.file === identity.path) {
        const info = await access.stat(entry.file);
        if (info.device !== BigInt(identity.device) || info.inode !== BigInt(identity.inode) ||
            createHash('sha256').update(await access.read(entry.file)).digest('hex') !== identity.sha256 ||
            !(await matchingMapping(entry, access))) return false;
        expected = true;
      } else if (hasGpuIcdExports(await access.read(entry.file)) || !(await matchingMapping(entry, access))) return false;
    }
    return expected;
  } catch {
    return false;
  }
}

/** Confirms that no mapped executable object defines a Vulkan ICD export. */
export async function verifyNoGpuDriver(loaderPath: string, access: DriverIdentityAccess = systemAccess): Promise<boolean> {
  if (!path.isAbsolute(loaderPath)) return false;
  try {
    for (const entry of driverMappings(await access.maps())) {
      if (!(await matchingMapping(entry, access))) return false;
      if (entry.file !== loaderPath && (hasGpuIcdExports(await access.read(entry.file)) || !(await matchingMapping(entry, access)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
