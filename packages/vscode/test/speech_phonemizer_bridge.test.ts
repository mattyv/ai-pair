import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workerData: {} as unknown, size: 0, digest: '' }));
const source = 'export async function phonemize(text, language) { return [text, language]; }';
vi.mock('node:worker_threads', () => ({
  get workerData() {
    return state.workerData;
  },
}));
vi.mock('../src/speech_model_manifest', () => {
  return {
    MODEL_REVISION: 'revision',
    get PHONEMIZER_ASSET() {
      return { path: 'runtime/phonemizer-1.2.1.mjs', size: state.size, sha256: state.digest };
    },
  };
});
let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
  state.workerData = {};
  state.size = 0;
  state.digest = '';
  vi.resetModules();
});

async function prepare(content = source): Promise<void> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pair-bridge-'));
  const modelPath = path.join(root, 'speech', 'revision');
  state.workerData = { modelPath };
  state.size = source.length;
  state.digest = createHash('sha256').update(source).digest('hex');
  await fs.mkdir(path.join(modelPath, 'runtime'), { recursive: true });
  await fs.writeFile(path.join(modelPath, 'runtime', 'phonemizer-1.2.1.mjs'), content);
}

it('loads only the verified local module and reuses it for subsequent calls', async () => {
  await prepare();
  expect(createHash('sha256').update(source).digest('hex')).toHaveLength(64);
  const bridge = await import('../src/speech_phonemizer_bridge');
  expect(await bridge.phonemize('hello', 'en-us')).toEqual(['hello', 'en-us']);
  if (root === undefined) throw new Error('missing test root');
  await fs.unlink(path.join(root, 'speech', 'revision', 'runtime', 'phonemizer-1.2.1.mjs'));
  expect(await bridge.phonemize('again', 'en-gb')).toEqual(['again', 'en-gb']);
});

it('refuses corrupt or missing modules before import', async () => {
  await prepare('bad');
  const bridge = await import('../src/speech_phonemizer_bridge');
  await expect(bridge.phonemize('hello', 'en-us')).rejects.toThrow(/verification/);
});

it('rejects arbitrary worker paths', async () => {
  state.workerData = { modelPath: '/tmp/unrelated' };
  const bridge = await import('../src/speech_phonemizer_bridge');
  await expect(bridge.phonemize('hello', 'en-us')).rejects.toThrow(/path/);
});

it('rejects missing worker context before accessing the filesystem', async () => {
  state.workerData = undefined;
  const bridge = await import('../src/speech_phonemizer_bridge');
  await expect(bridge.phonemize('hello')).rejects.toThrow(/path/);
});

it('rejects matching-size changed code before executing it', async () => {
  await prepare(source.replace('return [text, language]', 'return [language, text]'));
  const bridge = await import('../src/speech_phonemizer_bridge');
  await expect(bridge.phonemize('hello')).rejects.toThrow(/verification/);
});

it('rejects verified modules without the expected export', async () => {
  const content = 'export const unrelated = 1;';
  await prepare(content);
  state.size = content.length;
  state.digest = createHash('sha256').update(content).digest('hex');
  const bridge = await import('../src/speech_phonemizer_bridge');
  await expect(bridge.phonemize('hello')).rejects.toThrow(/invalid export/);
});
