import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as esbuild from 'esbuild';

/** Inputs for the isolated, optional Linux GPU runtime. */
export interface GpuRuntimeStageOptions {
  platform: string;
  arch: string;
  source: string;
  destination: string;
  nodeDirectory: string;
  digest?: (file: string) => string;
}

const VERSIONS = new Map([
  ['kokoro-js', '1.2.1'],
  ['@huggingface/transformers', '4.2.0'],
  ['onnxruntime-node', '1.24.3'],
  ['onnxruntime-common', '1.24.3'],
]);
const FILES = new Map<string, string[]>([
  [
    'kokoro-js',
    [
      'package.json',
      'LICENSE',
      'dist/kokoro.js',
      ...['af_heart', 'am_michael', 'bf_emma', 'bm_george'].map((voice) => `voices/${voice}.bin`),
    ],
  ],
  ['@huggingface/transformers', ['package.json', 'LICENSE', 'dist/transformers.node.mjs']],
  [
    'onnxruntime-node',
    ['package.json', 'dist', 'bin/napi-v6/linux/x64/onnxruntime_binding.node', 'bin/napi-v6/linux/x64/libonnxruntime.so.1'],
  ],
  ['onnxruntime-common', ['package.json', 'dist']],
  ['sharp', ['package.json', 'LICENSE', 'lib']],
  ['@img/sharp-linux-x64', ['package.json', 'LICENSE', 'lib']],
  ['@img/sharp-libvips-linux-x64', ['package.json', 'README.md', 'versions.json', 'lib']],
  ['@img/colour', ['package.json', 'LICENSE.md', 'index.cjs', 'color.cjs']],
  ['detect-libc', ['package.json', 'LICENSE', 'lib']],
  ['semver', ['package.json', 'LICENSE', 'index.js', 'classes', 'functions', 'internal', 'ranges']],
]);

/** Stages only the reviewed GPU runtime and isolated child entry. */
export async function stageGpuRuntime(options: GpuRuntimeStageOptions): Promise<void> {
  if (options.platform !== 'linux' || options.arch !== 'x64') return;
  for (const [name, version] of VERSIONS) {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(options.source, name, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || manifest.version !== version) {
      throw new Error(`Unexpected GPU runtime version: ${name}`);
    }
  }
  const digest = options.digest ?? ((file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const node = path.join(options.nodeDirectory, 'bin/node');
  const license = path.join(options.nodeDirectory, 'LICENSE');
  const graph = '../vscode/native/gpu_probe.onnx';
  if (
    digest(node) !== '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90' ||
    digest(license) !== 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4' ||
    digest(graph) !== '71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10'
  ) {
    throw new Error('Unverified GPU Node runtime.');
  }
  fs.mkdirSync(options.destination, { recursive: true });
  fs.cpSync(node, path.join(options.destination, 'node'), { recursive: true });
  fs.cpSync(license, path.join(options.destination, 'NODE-LICENSE'), { recursive: true });
  fs.cpSync(graph, path.join(options.destination, 'gpu_probe.onnx'), { recursive: true });
  const modules = path.join(options.destination, 'node_modules');
  for (const [name, entries] of FILES) {
    for (const entry of entries) {
      const target = path.join(modules, name, entry);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(options.source, name, entry), target, { recursive: true });
    }
  }
  const bridge = path.join(modules, 'phonemizer');
  fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(bridge, 'package.json'), JSON.stringify({ name: 'phonemizer', type: 'module', exports: './index.mjs' }));
  const common: esbuild.BuildOptions = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' };
  await esbuild.build({
    ...common,
    entryPoints: ['../vscode/src/speech_gpu_phonemizer_bridge.ts'],
    outfile: path.join(bridge, 'index.mjs'),
  });
  await esbuild.build({
    ...common,
    entryPoints: ['../vscode/src/speech_gpu_proof_worker.ts'],
    external: ['onnxruntime-node'],
    outfile: path.join(options.destination, 'gpu_proof_worker.mjs'),
  });
  await esbuild.build({
    ...common,
    entryPoints: ['../vscode/src/speech_gpu_worker.ts'],
    external: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
    outfile: path.join(options.destination, 'gpu_worker.mjs'),
  });
}
