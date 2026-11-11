// Only these runtime files are shipped; never copy an entire dependency tree.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const files: Record<string, string[]> = {
  'kokoro-js': [
    'package.json',
    'LICENSE',
    'dist/kokoro.js',
    ...['af_heart', 'am_michael', 'bf_emma', 'bm_george'].map((voice) => `voices/${voice}.bin`),
  ],
  '@huggingface/transformers': ['package.json', 'LICENSE', 'dist/transformers.node.mjs'],
  'onnxruntime-node': ['package.json', 'dist'],
  'onnxruntime-common': ['package.json', 'dist'],
  'sharp': ['package.json', 'LICENSE', 'lib'],
  '@img/colour': ['package.json', 'LICENSE.md', 'index.cjs', 'color.cjs'],
  'detect-libc': ['package.json', 'LICENSE', 'lib'],
  'semver': ['package.json', 'LICENSE', 'index.js', 'classes', 'functions', 'internal', 'ranges'],
};

/** Lists the files of each `sharp` image package that a host needs. */
const sharpFiles = ['package.json', 'LICENSE', 'lib'];
/** Lists the files of each separate `libvips` package that a host needs. */
const libvipsFiles = ['package.json', 'README.md', 'versions.json', 'lib'];

/** Each supported `<platform>-<arch>` host's native files, added to `files` (#39). */
const nativeFiles = new Map<string, Record<string, string[]>>([
  [
    'linux-x64',
    {
      'onnxruntime-node': [
        'bin/napi-v3/linux/x64/onnxruntime_binding.node',
        'bin/napi-v3/linux/x64/libonnxruntime.so.1',
        'bin/napi-v3/linux/x64/libonnxruntime_providers_shared.so',
      ],
      '@img/sharp-linux-x64': sharpFiles,
      '@img/sharp-libvips-linux-x64': libvipsFiles,
    },
  ],
  [
    'darwin-x64',
    {
      'onnxruntime-node': ['bin/napi-v3/darwin/x64/onnxruntime_binding.node', 'bin/napi-v3/darwin/x64/libonnxruntime.1.21.0.dylib'],
      '@img/sharp-darwin-x64': sharpFiles,
      '@img/sharp-libvips-darwin-x64': libvipsFiles,
    },
  ],
  [
    'darwin-arm64',
    {
      'onnxruntime-node': ['bin/napi-v3/darwin/arm64/onnxruntime_binding.node', 'bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib'],
      '@img/sharp-darwin-arm64': sharpFiles,
      '@img/sharp-libvips-darwin-arm64': libvipsFiles,
    },
  ],
]);

/** Copies each listed entry of each package from `source` to `destination`. */
function copyEntries(table: Record<string, string[]>, source: string, destination: string): void {
  for (const [name, entries] of Object.entries(table)) {
    for (const entry of entries) {
      const target = path.join(destination, name, entry);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(source, name, entry), target, { recursive: true });
    }
  }
}

/** Stages only the reviewed CPU runtime for a supported host, Linux x64 or macOS, and returns whether it did. */
export function stageSpeechRuntime(
  options: {
    platform: string;
    arch: string;
    source: string;
    destination: string;
  } = { platform: process.platform, arch: process.arch, source: '../../node_modules', destination: 'dist/speech' },
): boolean {
  const destination = path.join(options.destination, 'node_modules');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(options.destination, { recursive: true });
  fs.writeFileSync(path.join(options.destination, 'runtime.json'), JSON.stringify({ available: false }));
  const host = `${options.platform}-${options.arch}`;
  const native = nativeFiles.get(host);
  if (native === undefined) return false;
  copyEntries(files, options.source, destination);
  copyEntries(native, options.source, destination);
  if (host === 'linux-x64') {
    const library = fileURLToPath(new URL('../vendor/libstdcxx/libstdc++.so.6', import.meta.url));
    fs.copyFileSync(library, path.join(destination, 'onnxruntime-node', 'bin', 'napi-v3', 'linux', 'x64', 'libstdc++.so.6'));
  }
  const bridge = path.join(destination, 'phonemizer');
  fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(bridge, 'package.json'), JSON.stringify({ name: 'phonemizer', type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(
    path.join(options.destination, 'runtime.json'),
    JSON.stringify({ available: true, platform: options.platform, arch: options.arch }),
  );
  return true;
}
