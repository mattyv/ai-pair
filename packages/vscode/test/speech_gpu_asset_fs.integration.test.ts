import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gpuAssetFilesystem } from '../src/speech_gpu_asset_fs';

let directory = '';
afterEach(async () => {
  if (directory !== '') await rm(directory, { recursive: true, force: true });
  directory = '';
});
it('lists regular files and reads only within the expected size', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gpu-assets-'));
  await mkdir(path.join(directory, 'nested'));
  await writeFile(path.join(directory, 'nested', 'file'), 'hello');
  expect(await gpuAssetFilesystem.list(directory)).toEqual(['nested/file']);
  expect(Buffer.from(await gpuAssetFilesystem.read(path.join(directory, 'nested', 'file'), 5)).toString()).toBe('hello');
  await expect(gpuAssetFilesystem.read(path.join(directory, 'nested', 'file'), 4)).rejects.toThrow();
});
it('rejects symbolic links and non-regular files', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gpu-assets-'));
  await writeFile(path.join(directory, 'target'), 'x');
  await symlink('target', path.join(directory, 'link'));
  await expect(gpuAssetFilesystem.list(directory)).rejects.toThrow();
  await expect(gpuAssetFilesystem.read(path.join(directory, 'link'), 1)).rejects.toThrow();
});
