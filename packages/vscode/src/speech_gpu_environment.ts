/** Builds a minimal child environment without inherited loader or layer settings. */
export function gpuEnvironment(driverManifest: string): NodeJS.ProcessEnv {
  return { LANG: 'C', VK_DRIVER_FILES: driverManifest };
}
