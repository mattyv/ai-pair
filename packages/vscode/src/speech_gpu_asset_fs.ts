import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { GpuAssetAccess } from './speech_gpu_assets';

const MAX_RUNTIME_FILES = 5000;

/** Reads only regular GPU runtime files and rejects symlinks and unexpected entries. */
export const gpuAssetFilesystem: GpuAssetAccess = {
  list: async (root) => {
    const files: string[] = [];
    async function visit(relative: string): Promise<void> {
      const current = path.join(root, relative);
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid GPU runtime directory.');
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) await visit(name);
        else if (entry.isFile()) {
          files.push(name);
          if (files.length > MAX_RUNTIME_FILES) throw new Error('GPU runtime is too large.');
        } else throw new Error('Invalid GPU runtime entry.');
      }
    }
    await visit('');
    return files.toSorted();
  },
  read: async (file, limit) => {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== limit) throw new Error('Invalid GPU runtime file.');
      const data = Buffer.alloc(limit + 1);
      let offset = 0;
      while (offset < data.length) {
        const result = await handle.read(data, offset, data.length - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      if (offset !== limit) throw new Error('Invalid GPU runtime file size.');
      return data.subarray(0, offset);
    } finally {
      await handle.close();
    }
  },
};
