import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stageAssets } from '../src/stage';
import { resolveBundledHelper } from '../src/helper_manifest';

it('stages only fixed helper names and writes a reproducible digest manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-stage-test-'));
  try {
    const input = join(root, 'input');
    const output = join(root, 'companion');
    await mkdir(input);
    await writeFile(join(input, 'audio-darwin-arm64'), 'binary-a');
    await writeFile(join(input, 'ignored'), 'not a helper');
    await stageAssets(input, output);
    const manifest = await readFile(join(output, 'dist', 'audio-native', 'manifest.json'), 'utf8');
    await stageAssets(input, output);
    expect(await readFile(join(output, 'dist', 'audio-native', 'manifest.json'), 'utf8')).toBe(manifest);
    await expect(resolveBundledHelper(output, 'darwin', 'arm64')).resolves.toBe(join(output, 'dist', 'audio-native', 'audio-darwin-arm64'));
    await expect(resolveBundledHelper(output, 'win32', 'x64')).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('fails explicitly when there are no helper binaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-stage-empty-'));
  try {
    await expect(stageAssets(root, join(root, 'out'))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('requires all four helpers when building the universal companion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-stage-universal-'));
  try {
    const input = join(root, 'input');
    const output = join(root, 'companion');
    await mkdir(input);
    await writeFile(join(input, 'audio-darwin-arm64'), 'a');
    await expect(stageAssets(input, output, true)).rejects.toThrow();
    await Promise.all(
      ['audio-darwin-x64', 'audio-win32-x64.exe', 'audio-win32-arm64.exe'].map((name) => writeFile(join(input, name), name)),
    );
    await stageAssets(input, output, true);
    await expect(resolveBundledHelper(output, 'win32', 'x64')).resolves.toBe(join(output, 'dist', 'audio-native', 'audio-win32-x64.exe'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
