import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MODEL_REVISION, PHONEMIZER_ASSET } from './speech_model_manifest';

type Phonemizer = (text: string, language?: string) => Promise<string[]>;
let loaded: Promise<Phonemizer> | undefined;

function isPhonemizer(value: unknown): value is Phonemizer {
  return typeof value === 'function';
}

/** The child receives the verified model directory as its third launch argument. */
async function loadPhonemizer(): Promise<Phonemizer> {
  const root = process.argv[4];
  if (root === undefined) throw new Error('Invalid local speech model path.');
  if (
    !path.isAbsolute(root) ||
    path.resolve(root) !== root ||
    path.basename(root) !== MODEL_REVISION ||
    path.basename(path.dirname(root)) !== 'speech-gpu'
  ) {
    throw new Error('Invalid local speech model path.');
  }
  const file = path.join(root, PHONEMIZER_ASSET.path);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size !== PHONEMIZER_ASSET.size) throw new Error('Speech phonemizer verification failed.');
  const bytes = await fs.readFile(file);
  if (bytes.length !== PHONEMIZER_ASSET.size || createHash('sha256').update(bytes).digest('hex') !== PHONEMIZER_ASSET.sha256) {
    throw new Error('Speech phonemizer verification failed.');
  }
  // Import the verified bytes, not the path, so a later file replacement cannot
  // change the code after the digest check. The pinned module is self-contained.
  const module: unknown = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
  if (typeof module !== 'object' || module === null || !('phonemize' in module) || !isPhonemizer(module.phonemize)) {
    throw new Error('Speech phonemizer has an invalid export.');
  }
  return module.phonemize;
}

/** Provides Kokoro's phonemizer interface using only the verified local cache. */
export async function phonemize(text: string, language?: string): Promise<string[]> {
  loaded ??= loadPhonemizer();
  return (await loaded)(text, language);
}
