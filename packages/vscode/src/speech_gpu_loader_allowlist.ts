/** Operations used to verify the system loader before a GPU child is started. */
export interface GpuLoaderAccess {
  realpath: (file: string) => Promise<string>;
  trusted: (file: string) => Promise<boolean>;
  hash: (file: string) => Promise<string>;
}

/** The exact loader identity passed to the isolated child. */
export interface TrustedGpuLoader {
  path: string;
  sha256: string;
}

const LOADER_LINK = '/usr/lib/x86_64-linux-gnu/libvulkan.so.1';
// Extracted from official Ubuntu noble/resolute and Debian trixie amd64 packages.
const TRUSTED_LOADERS = new Map([
  ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1.3.275', 'e833b010f814b72c6aca0300c8b5f19b6106ffa06c24ddc95a293970c7d6058e'],
  ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1.4.341', 'def4af45e9e5784cf65eaaaa289530a5c73546b01015da4c0920ef0a144fe189'],
  ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1.4.309', 'bbd6827e9fe418e9b9740aea57ce6d21fcea03e9876b4b17835c5a9c58f849fc'],
]);

/** Selects only an exact reviewed loader with a root-owned, non-writable path. */
export async function trustedGpuLoader(fs: GpuLoaderAccess): Promise<TrustedGpuLoader | undefined> {
  try {
    if (!(await fs.trusted(LOADER_LINK))) return undefined;
    const file = await fs.realpath(LOADER_LINK);
    const sha256 = TRUSTED_LOADERS.get(file);
    if (sha256 === undefined || !(await fs.trusted(file)) || (await fs.hash(file)) !== sha256) return undefined;
    return { path: file, sha256 };
  } catch {
    return undefined;
  }
}
