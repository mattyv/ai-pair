import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { KOKORO_HOSTS } from '@ai-pair/protocol';

/** Only a complete runtime staged for this Kokoro host advertises speech availability. */
export async function speechRuntimeAvailable(runtimeDirectory: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(runtimeDirectory, 'runtime.json'), 'utf8'));
    if (typeof value !== 'object' || value === null) return false;
    return (
      'available' in value &&
      value.available === true &&
      'platform' in value &&
      'arch' in value &&
      value.arch === process.arch &&
      value.platform === process.platform &&
      KOKORO_HOSTS.includes(`${process.platform}-${process.arch}`)
    );
  } catch {
    return false;
  }
}
