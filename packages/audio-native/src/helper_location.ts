/** Only names from this fixed platform matrix may be joined to the trusted extension directory. */
export function helperFilename(platform: string, architecture: string): string | undefined {
  if (architecture !== 'arm64' && architecture !== 'x64') return undefined;
  if (platform === 'darwin') return `audio-darwin-${architecture}`;
  if (platform === 'win32') return `audio-win32-${architecture}.exe`;
  return undefined;
}
