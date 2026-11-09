/** Builds a child environment using only the explicitly verified loader and driver. */
export function gpuEnvironment(
  driverManifest: string,
  loaderPath: string,
): Readonly<{ LANG: 'C'; VK_DRIVER_FILES: string; VK_LOADER_LAYERS_DISABLE: '~all~'; LD_PRELOAD: string }> {
  return { LANG: 'C', VK_DRIVER_FILES: driverManifest, VK_LOADER_LAYERS_DISABLE: '~all~', LD_PRELOAD: loaderPath };
}
