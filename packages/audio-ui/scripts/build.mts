import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { stageGpuRuntime } from './gpu_runtime.mts';
import { gpuManifest } from './gpu_manifest.mts';
import { stageAssets } from '../../audio-native/src/stage.ts';
import { stageCompanionSpeech } from './speech_runtime.mts';
import { companionBuildIdentity, type CompanionBuildInput } from './build_identity.mts';

const production = process.argv.includes('--production');
const universal = process.argv.includes('--universal') || process.env.AI_PAIR_UNIVERSAL_AUDIO === '1';
const assetDirectory = process.env.AI_PAIR_NATIVE_ASSETS;
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('../../LICENSE', 'LICENSE');
fs.copyFileSync('../vscode/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
fs.cpSync('../vscode/third_party', 'third_party', { recursive: true });
await esbuild.build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2025',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  entryPoints: ['../vscode/src/webview/panel.ts'],
  outfile: 'dist/panel.js',
});
await esbuild.build({
  minify: production,
  logLevel: 'warning',
  entryPoints: ['../vscode/src/webview/panel.css'],
  outfile: 'dist/panel.css',
});
await stageCompanionSpeech({ platform: process.platform, arch: process.arch, source: '../../node_modules', destination: 'dist/speech' });

const gpuSource = process.env.AI_PAIR_GPU_RUNTIME_SOURCE ?? 'gpu-runtime/node_modules';
const gpuNode = process.env.AI_PAIR_GPU_NODE_SOURCE ?? 'gpu-runtime/node_modules/.gpu-node';
let gpuAssets: ReturnType<typeof gpuManifest> = [];
if (process.platform === 'linux' && process.arch === 'x64' && fs.existsSync(gpuSource) && fs.existsSync(path.join(gpuNode, 'bin/node'))) {
  await stageGpuRuntime({
    platform: process.platform,
    arch: process.arch,
    source: gpuSource,
    nodeDirectory: gpuNode,
    destination: 'dist/speech-gpu',
  });
  execFileSync('cc', [
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I../vscode/native/vulkan/include',
    '../vscode/native/gpu_probe.c',
    '-ldl',
    '-o',
    'dist/speech-gpu/gpu_probe',
  ]);
  gpuAssets = gpuManifest('dist/speech-gpu');
} else if (universal) {
  throw new Error('A Linux x64 GPU runtime source is required for a universal release.');
}

if (assetDirectory !== undefined && assetDirectory !== '') await stageAssets(assetDirectory, process.cwd(), universal);
else if (universal) throw new Error('AI_PAIR_NATIVE_ASSETS is required for a universal companion package.');
const manifest: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
  throw new Error('Companion package has no version.');
}
const extensionOptions: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  external: ['vscode'],
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  define: {
    AI_PAIR_VERSION: JSON.stringify(manifest.version),
    AI_PAIR_BUILD_ID: JSON.stringify('pending'),
    AI_PAIR_GPU_ASSETS: JSON.stringify(gpuAssets),
  },
};
const preliminary = await esbuild.build({ ...extensionOptions, write: false });
const inputs: CompanionBuildInput[] = [{ name: 'mode', content: production ? 'production' : 'development' }];
for (const output of preliminary.outputFiles) inputs.push({ name: path.basename(output.path), content: output.contents });
for (const file of [
  'dist/panel.js',
  'dist/panel.css',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'scripts/build.mts',
  'scripts/build_identity.mts',
  'scripts/speech_runtime.mts',
]) {
  inputs.push({ name: file, content: fs.readFileSync(file) });
}
/** Adds every staged runtime or native asset in stable name order. */
function addDirectory(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).toSorted((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) addDirectory(file);
    else if (entry.isFile()) inputs.push({ name: file, content: fs.readFileSync(file) });
  }
}
addDirectory('dist/speech');
if (fs.existsSync('dist/speech-gpu')) addDirectory('dist/speech-gpu');
addDirectory('third_party');
if (fs.existsSync('dist/audio-native')) addDirectory('dist/audio-native');
const buildId = companionBuildIdentity(inputs);
await esbuild.build({
  ...extensionOptions,
  define: {
    AI_PAIR_VERSION: JSON.stringify(manifest.version),
    AI_PAIR_BUILD_ID: JSON.stringify(buildId),
    AI_PAIR_GPU_ASSETS: JSON.stringify(gpuAssets),
  },
});
