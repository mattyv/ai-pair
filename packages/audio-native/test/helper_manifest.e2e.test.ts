import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveBundledHelper } from '../src/helper_manifest';

it('resolves only a matching, intact fixed-name bundled helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-helper-test-'));
  try {
    const directory = join(root, 'dist', 'audio-native');
    await mkdir(directory, { recursive: true });
    const name = 'audio-darwin-arm64';
    const data = Buffer.from('synthetic helper');
    await writeFile(join(directory, name), data);
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ version: 1, sha256: { [name]: createHash('sha256').update(data).digest('hex') } }),
    );
    await expect(resolveBundledHelper(root, 'darwin', 'arm64')).resolves.toBe(join(directory, name));
    await writeFile(join(directory, name), 'changed');
    await expect(resolveBundledHelper(root, 'darwin', 'arm64')).resolves.toBeUndefined();
    await expect(resolveBundledHelper(root, '../bin', 'arm64')).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects missing, malformed, and non-file packaged assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-helper-invalid-'));
  try {
    const directory = join(root, 'dist', 'audio-native');
    await mkdir(directory, { recursive: true });
    await expect(resolveBundledHelper(root, 'darwin', 'x64')).resolves.toBeUndefined();
    await mkdir(join(directory, 'audio-darwin-x64'));
    await writeFile(join(directory, 'manifest.json'), '{}');
    await expect(resolveBundledHelper(root, 'darwin', 'x64')).resolves.toBeUndefined();
    await rm(join(directory, 'audio-darwin-x64'), { recursive: true });
    await writeFile(join(directory, 'audio-darwin-x64'), 'data');
    await writeFile(join(directory, 'manifest.json'), 'invalid-json');
    await expect(resolveBundledHelper(root, 'darwin', 'x64')).resolves.toBeUndefined();
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, sha256: { 'audio-darwin-x64': 'not-a-hash' } }));
    await expect(resolveBundledHelper(root, 'darwin', 'x64')).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
