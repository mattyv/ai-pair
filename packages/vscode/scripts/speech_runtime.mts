// Only these runtime files are shipped; never copy an entire dependency tree.
import * as fs from 'node:fs';
import * as path from 'node:path';

const files: Record<string, string[]> = {
  'kokoro-js': [
    'package.json',
    'LICENSE',
    'dist/kokoro.js',
    ...['af_heart', 'am_michael', 'bf_emma', 'bm_george'].map((voice) => `voices/${voice}.bin`),
  ],
  '@huggingface/transformers': ['package.json', 'LICENSE', 'dist/transformers.node.mjs'],
  'onnxruntime-node': [
    'package.json',
    'dist',
    'bin/napi-v3/linux/x64/onnxruntime_binding.node',
    'bin/napi-v3/linux/x64/libonnxruntime.so.1',
    'bin/napi-v3/linux/x64/libonnxruntime_providers_shared.so',
  ],
  'onnxruntime-common': ['package.json', 'dist'],
  'sharp': ['package.json', 'LICENSE', 'lib'],
  '@img/sharp-linux-x64': ['package.json', 'LICENSE', 'lib'],
  '@img/sharp-libvips-linux-x64': ['package.json', 'README.md', 'versions.json', 'lib'],
  '@img/colour': ['package.json', 'LICENSE.md', 'index.cjs', 'color.cjs'],
  'detect-libc': ['package.json', 'LICENSE', 'lib'],
  'semver': ['package.json', 'LICENSE', 'index.js', 'classes', 'functions', 'internal', 'ranges'],
};

/** Stage only the reviewed Linux x64 CPU runtime. */
export function stageSpeechRuntime(
  options: {
    platform: string;
    arch: string;
    source: string;
    destination: string;
  } = { platform: process.platform, arch: process.arch, source: '../../node_modules', destination: 'dist/speech' },
): void {
  const destination = path.join(options.destination, 'node_modules');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(options.destination, { recursive: true });
  fs.writeFileSync(path.join(options.destination, 'runtime.json'), JSON.stringify({ available: false }));
  if (options.platform !== 'linux' || options.arch !== 'x64') return;
  for (const [name, entries] of Object.entries(files)) {
    for (const entry of entries) {
      const source = path.join(options.source, name, entry);
      const target = path.join(destination, name, entry);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true });
    }
  }
  const bridge = path.join(destination, 'phonemizer');
  fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(bridge, 'package.json'), JSON.stringify({ name: 'phonemizer', type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(options.destination, 'runtime.json'), JSON.stringify({ available: true, platform: 'linux', arch: 'x64' }));
}
