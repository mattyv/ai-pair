import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GpuAsset } from '../../vscode/src/speech_gpu_assets';

/** Builds an exhaustive, stable list of staged GPU runtime content hashes. */
export function gpuManifest(root: string): GpuAsset[] {
  const result: GpuAsset[] = [];
  function visit(relative: string): void {
    const directory = path.join(root, relative);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).toSorted((left, right) => left.name.localeCompare(right.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        visit(name);
      } else if (entry.isFile()) {
        const data = fs.readFileSync(path.join(root, name));
        result.push({ path: name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      } else {
        throw new Error('GPU runtime contains an unsupported file.');
      }
    }
  }
  visit('');
  return result;
}
