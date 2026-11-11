import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  it.each([
    ['win32', 'x64'],
    ['linux', 'arm64'],
    ['darwin', 'ia32'],
  ])('builds a text-only package on unsupported %s %s without native packages', async (platform, arch) => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    expect(stageSpeechRuntime({ platform, arch, source: path.join(directory, 'missing'), destination: directory })).toBe(false);
    expect(JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'))).toEqual({ available: false });
  });

  it.each([
    ['linux', 'x64'],
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
  ])('fails %s %s builds if any required runtime files are missing', async (platform, arch) => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    const dest = directory;
    expect(() => {
      stageSpeechRuntime({ platform, arch, source: path.join(dest, 'missing'), destination: dest });
    }).toThrow();
    expect(JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'))).toEqual({ available: false });
  });
  it.each([
    ['linux', 'x64'],
    ['darwin', 'arm64'],
  ])('accepts only the complete runtime marker staged for this %s %s host', async (platform, arch) => {
    const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const hostArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
      expect(await speechRuntimeAvailable(directory)).toBe(false);
      const marker = path.join(directory, 'runtime.json');
      for (const value of [
        'invalid json',
        'null',
        '{}',
        JSON.stringify({ available: false, platform, arch }),
        JSON.stringify({ available: true, platform }),
        JSON.stringify({ available: true, platform: 'win32', arch }),
        JSON.stringify({ available: true, platform, arch: 'ia32' }),
      ]) {
        await writeFile(marker, value);
        expect(await speechRuntimeAvailable(directory)).toBe(false);
      }
      await writeFile(marker, JSON.stringify({ available: true, platform, arch }));
      expect(await speechRuntimeAvailable(directory)).toBe(true);
    } finally {
      if (hostPlatform !== undefined) Object.defineProperty(process, 'platform', hostPlatform);
      if (hostArch !== undefined) Object.defineProperty(process, 'arch', hostArch);
    }
  });
  it('refuses a marker on a host that cannot run Kokoro, even when it names that host', async () => {
    const hostArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'arch', { value: 'ia32', configurable: true });
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
      await writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ available: true, platform: process.platform, arch: 'ia32' }));
      expect(await speechRuntimeAvailable(directory)).toBe(false);
    } finally {
      if (hostArch !== undefined) Object.defineProperty(process, 'arch', hostArch);
    }
  });
  it.each([
    ['linux', 'x64', 'linux'],
    ['darwin', 'x64', 'darwin'],
    ['darwin', 'arm64', 'darwin'],
  ])('stages a complete %s %s runtime from any build host', async (platform, arch, napi) => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    const source = path.join(directory, 'source');
    const destination = path.join(directory, 'out');
    // Creates each entry the staging asks for until it has them all, so every host stages on any OS.
    for (;;) {
      try {
        expect(stageSpeechRuntime({ platform, arch, source, destination })).toBe(true);
        break;
      } catch (error: unknown) {
        if (!(error instanceof Error) || !('path' in error) || typeof error.path !== 'string' || !error.path.startsWith(source)) {
          throw error;
        }
        await mkdir(path.dirname(error.path), { recursive: true });
        await writeFile(error.path, '');
      }
    }
    expect(JSON.parse(await readFile(path.join(destination, 'runtime.json'), 'utf8'))).toEqual({ available: true, platform, arch });
    expect(await readdir(path.join(destination, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3'))).toEqual([napi]);
    const vendored = (await readdir(path.join(destination, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', napi, arch))).includes(
      'libstdc++.so.6',
    );
    expect(vendored).toBe(platform === 'linux');
  });
  it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('stages only the supported voices and Linux CPU runtime', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
    expect(
      stageSpeechRuntime({ platform: 'linux', arch: 'x64', source: path.join(process.cwd(), 'node_modules'), destination: directory }),
    ).toBe(true);
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
  it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')(
    'stages only the supported voices and macOS arm64 CPU runtime',
    async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'pair-runtime-'));
      expect(
        stageSpeechRuntime({ platform: 'darwin', arch: 'arm64', source: path.join(process.cwd(), 'node_modules'), destination: directory }),
      ).toBe(true);
      expect(await speechRuntimeAvailable(directory)).toBe(true);
      expect(await readdir(path.join(directory, 'node_modules', 'phonemizer'))).toEqual(['package.json']);
      expect(await readdir(path.join(directory, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3'))).toEqual(['darwin']);
      expect(
        (await readdir(path.join(directory, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'darwin', 'arm64'))).toSorted(),
      ).toEqual(['libonnxruntime.1.21.0.dylib', 'onnxruntime_binding.node']);
      expect((await readdir(path.join(directory, 'node_modules', '@img'))).toSorted()).toEqual([
        'colour',
        'sharp-darwin-arm64',
        'sharp-libvips-darwin-arm64',
      ]);
    },
  );
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
