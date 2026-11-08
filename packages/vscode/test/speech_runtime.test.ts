import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { stageSpeechRuntime } from '../scripts/speech_runtime.mjs';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('speech runtime staging', () => {
  it('builds a text-only package on unsupported platforms without Linux packages', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    stageSpeechRuntime({ platform: 'darwin', arch: 'arm64', source: path.join(directory, 'missing'), destination: directory });
    expect(JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'))).toEqual({ available: false });
  });

  it('fails Linux builds if any required runtime files are missing', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    const dest = directory;
    expect(() => {
      stageSpeechRuntime({ platform: 'linux', arch: 'x64', source: path.join(dest, 'missing'), destination: dest });
    }).toThrow();
    expect(JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'))).toEqual({ available: false });
  });
  it('accepts only the explicit complete Linux runtime marker', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    expect(await speechRuntimeAvailable(directory)).toBe(false);
    const marker = path.join(directory, 'runtime.json');
    for (const value of [
      'invalid json',
      'null',
      '{}',
      '{"available":true,"platform":"darwin","arch":"x64"}',
      '{"available":true,"platform":"linux","arch":"arm64"}',
    ]) {
      await writeFile(marker, value);
      expect(await speechRuntimeAvailable(directory)).toBe(false);
    }
    await writeFile(marker, JSON.stringify({ available: true, platform: 'linux', arch: 'x64' }));
    expect(await speechRuntimeAvailable(directory)).toBe(true);
  });
  it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('stages only the supported voices and Linux CPU runtime', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    stageSpeechRuntime({ platform: 'linux', arch: 'x64', source: path.join(process.cwd(), 'node_modules'), destination: directory });
    expect(await speechRuntimeAvailable(directory)).toBe(true);
    expect(await readdir(path.join(directory, 'node_modules', 'phonemizer'))).toEqual(['package.json']);
    expect((await readdir(path.join(directory, 'node_modules', 'kokoro-js', 'voices'))).toSorted()).toEqual([
      'af_heart.bin',
      'am_michael.bin',
      'bf_emma.bin',
      'bm_george.bin',
    ]);
    expect(await readdir(path.join(directory, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3'))).toEqual(['linux']);
    const library = await readFile(
      path.join(directory, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'linux', 'x64', 'libstdc++.so.6'),
    );
    expect(createHash('sha256').update(library).digest('hex')).toBe('07897b0e78c122f6536d467bc5872b5b51e759b670db35099275f5e41a25a3da');
  });
  it('keeps the vendor phonemizer out of worker and bridge bundles', async () => {
    for (const entry of ['packages/vscode/src/speech_worker.ts', 'packages/vscode/src/speech_phonemizer_bridge.ts']) {
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        external: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
        metafile: true,
        write: false,
        logLevel: 'silent',
      });
      expect(Object.keys(result.metafile.inputs).some((file) => file.includes('node_modules/phonemizer/'))).toBe(false);
    }
  });
});
