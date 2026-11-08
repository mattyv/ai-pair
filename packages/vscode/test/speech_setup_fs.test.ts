import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installedSpeechModel, setupSpeech } from '../src/speech_setup';

const hooks = vi.hoisted(() => ({
  cancel: undefined as (() => void) | undefined,
  cancelAfterBackup: false,
  failCommit: false,
  failRollback: false,
}));
vi.mock('../src/speech_model_manifest', () => ({
  MODEL_REVISION: 'revision',
  MODEL_ASSETS: [
    { path: 'config.json', size: 6, sha256: 'b79606fb3afea5bd1609ed40b622142f1c98125abcfe89a76a661b0e8e343910' },
    {
      path: 'runtime/asset.mjs',
      size: 6,
      sha256: 'b79606fb3afea5bd1609ed40b622142f1c98125abcfe89a76a661b0e8e343910',
      url: 'https://cdn.jsdelivr.net/fixed/asset.mjs',
    },
  ],
  MODEL_URL: 'https://huggingface.co/fixed/revision',
}));
vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 1 },
  window: {
    withProgress: async (options: unknown, run: (progress: unknown, token: unknown) => Promise<void>) => (
      void options,
      run(
        { report: () => {} },
        {
          isCancellationRequested: false,
          onCancellationRequested: (cancel: () => void) => {
            hooks.cancel = cancel;
            return { dispose: () => {} };
          },
        },
      )
    ),
  },
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename: async (from: string, to: string) => {
      if (hooks.failRollback && from.endsWith('.old')) throw new Error('rollback failed');
      if (hooks.failCommit && path.basename(from).startsWith('.setup-') && !from.endsWith('.old')) throw new Error('commit failed');
      await original.rename(from, to);
      if (hooks.cancelAfterBackup && to.endsWith('.old')) hooks.cancel?.();
    },
  };
});

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
  hooks.cancel = undefined;
  hooks.cancelAfterBackup = false;
  hooks.failCommit = false;
  hooks.failRollback = false;
  vi.unstubAllGlobals();
});

async function existingInvalid(): Promise<string> {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pair-model-'));
  const target = path.join(directory, 'speech', 'revision');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'old'), 'preserve');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('config'))),
  );
  return target;
}

it('replaces a nonempty invalid directory using real filesystem renames', async () => {
  const target = await existingInvalid();
  await setupSpeech(path.dirname(path.dirname(target)));
  expect(await installedSpeechModel(path.dirname(path.dirname(target)))).toBe(
    path.join(path.dirname(path.dirname(target)), 'speech', 'revision'),
  );
});

it('restores the previous directory if cancelled after backup', async () => {
  const target = await existingInvalid();
  hooks.cancelAfterBackup = true;
  await expect(setupSpeech(path.dirname(path.dirname(target)))).rejects.toThrow(/cancel/i);
  expect(await fs.readFile(path.join(target, 'old'), 'utf8')).toBe('preserve');
  expect(await installedSpeechModel(path.dirname(path.dirname(target)))).toBeUndefined();
});

it('restores the previous directory if commit rename fails', async () => {
  const target = await existingInvalid();
  hooks.failCommit = true;
  await expect(setupSpeech(path.dirname(path.dirname(target)))).rejects.toThrow('commit failed');
  expect(await fs.readFile(path.join(target, 'old'), 'utf8')).toBe('preserve');
});

it('preserves the backup directory if rollback also fails', async () => {
  const target = await existingInvalid();
  const root = path.dirname(target);
  hooks.failCommit = true;
  hooks.failRollback = true;
  await expect(setupSpeech(path.dirname(root))).rejects.toThrow('rollback failed');
  const backup = (await fs.readdir(root)).find((entry) => entry.endsWith('.old'));
  expect(backup).toBeDefined();
  if (backup === undefined) throw new Error('missing backup');
  expect(await fs.readFile(path.join(root, backup, 'old'), 'utf8')).toBe('preserve');
});
