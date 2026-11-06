import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Only a complete staged Linux x64 runtime advertises speech availability. */
export async function speechRuntimeAvailable(runtimeDirectory: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(runtimeDirectory, 'runtime.json'), 'utf8'));
    if (typeof value !== 'object' || value === null) return false;
    return (
      'available' in value &&
      value.available === true &&
      'platform' in value &&
      value.platform === 'linux' &&
      'arch' in value &&
      value.arch === 'x64'
    );
  } catch {
    return false;
  }
}
