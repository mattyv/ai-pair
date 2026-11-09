import * as path from 'node:path';
import type { GpuDriverIdentity } from './speech_gpu_driver_identity';

/** Access needed to select a trusted system Radeon Vulkan driver. */
export interface GpuDriverAccess {
  trusted: (file: string) => Promise<boolean>;
  read: (file: string) => Promise<string>;
  realpath: (file: string) => Promise<string>;
  identity: (file: string) => Promise<GpuDriverIdentity>;
}

/** A trusted system ICD and immutable identity of its Radeon library. */
export interface TrustedGpuDriver {
  readonly manifest: string;
  readonly identity: GpuDriverIdentity;
}

const DRIVER_LIBRARY = '/usr/lib/x86_64-linux-gnu/libvulkan_radeon.so';
const DRIVER_SONAME = 'libvulkan_radeon.so';
const MANIFESTS = ['/usr/share/vulkan/icd.d/radeon_icd.x86_64.json', '/usr/share/vulkan/icd.d/radeon_icd.json'];

/** Selects a trusted Radeon ICD and captures its canonical library identity. */
export async function findGpuDriver(fs: GpuDriverAccess): Promise<TrustedGpuDriver | undefined> {
  try {
    if (!(await fs.trusted(DRIVER_LIBRARY))) return undefined;
    const canonical = await fs.realpath(DRIVER_LIBRARY);
    if (!path.isAbsolute(canonical) || !(await fs.trusted(canonical))) return undefined;
    const identity = await fs.identity(canonical);
    if (
      identity.path !== canonical ||
      !/^[a-f0-9]{64}$/.test(identity.sha256) ||
      !/^\d+$/.test(identity.device) ||
      !/^\d+$/.test(identity.inode)
    ) {
      return undefined;
    }
    for (const file of MANIFESTS) {
      try {
        if (!(await fs.trusted(file))) continue;
        const manifest: unknown = JSON.parse(await fs.read(file));
        if (
          typeof manifest === 'object' &&
          manifest !== null &&
          'ICD' in manifest &&
          typeof manifest.ICD === 'object' &&
          manifest.ICD !== null &&
          'library_path' in manifest.ICD &&
          (manifest.ICD.library_path === DRIVER_LIBRARY || manifest.ICD.library_path === DRIVER_SONAME)
        ) {
          return Object.freeze({ manifest: file, identity: Object.freeze({ ...identity }) });
        }
      } catch {
        // An invalid candidate cannot authorize a GPU process.
      }
    }
  } catch {
    // Driver verification errors are unavailable.
  }
  return undefined;
}
