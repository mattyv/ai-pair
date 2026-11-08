// Checks model status against real files inside the VS Code extension host.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MODEL_REVISION, MODEL_URL } from '../src/speech_model_manifest';
import { speechModelStatus } from '../src/speech_setup';

/** Checks missing and incomplete model directories without downloading anything. */
export async function modelStatusPaths(): Promise<void> {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-model-status-'));
  try {
    const directory = path.join(storage, 'speech', MODEL_REVISION);
    assert.deepEqual(await speechModelStatus(storage), {
      path: directory,
      source: MODEL_URL,
      revision: MODEL_REVISION,
      verified: false,
      download: 'missing',
    });
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'config.json'), 'incomplete');
    assert.deepEqual(await speechModelStatus(storage), {
      path: directory,
      source: MODEL_URL,
      revision: MODEL_REVISION,
      verified: false,
      download: 'installed',
    });
  } finally {
    await fs.rm(storage, { recursive: true, force: true });
  }
}
