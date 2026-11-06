// Bundles the extension and the relay it ships. `--production` minifies and drops source maps.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';

/** A compact SHA-256 prefix shown in the panel. */
const BUILD_ID_LENGTH = 16;
const production = process.argv.includes('--production');
if (production) {
  fs.rmSync('dist', { recursive: true, force: true });
  // The package needs its license next to it; the source of truth is the repository's.
  fs.copyFileSync('../../LICENSE', 'LICENSE');
}

const common: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // The oldest VS Code the extension supports, 1.106, runs Node 22.20 (measured).
  target: 'node22',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  // jsonc-parser's `main` is a UMD build whose requires esbuild can't follow; its ES module build bundles.
  mainFields: ['module', 'main'],
};

// The narration panel's page script, for the webview.
await esbuild.build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2025',
  minify: production,
  sourcemap: !production,
  logLevel: 'warning',
  entryPoints: ['src/webview/panel.ts'],
  outfile: 'dist/panel.js',
});
// The narration panel's page styles.
await esbuild.build({ minify: production, logLevel: 'warning', entryPoints: ['src/webview/panel.css'], outfile: 'dist/panel.css' });
// The relay tells agents the extension's version.
const manifest: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
  throw new Error('package.json has no version.');
}
await esbuild.build({
  ...common,
  entryPoints: ['../relay/src/main.ts'],
  loader: { '.md': 'text' },
  define: { AI_PAIR_VERSION: JSON.stringify(manifest.version) },
  outfile: 'dist/relay.js',
});

// Hash the extension with a fixed build-id placeholder, plus every other file
// shipped in the VSIX. This avoids hashing a bundle that contains its own hash.
const extensionOptions: esbuild.BuildOptions = {
  ...common,
  entryPoints: ['src/extension.ts'],
  external: ['vscode'],
  outfile: 'dist/extension.js',
  define: { AI_PAIR_VERSION: JSON.stringify(manifest.version), AI_PAIR_BUILD_ID: JSON.stringify('pending') },
};
const preliminary = await esbuild.build({ ...extensionOptions, write: false });
const hash = createHash('sha256');
/** Adds a length-framed name and a fixed-size content digest to the build hash. */
function addInput(name: string, content: string | Uint8Array): void {
  const digest = createHash('sha256');
  digest.update(content);
  hash.update(`${name.length}:${name}:`);
  hash.update(digest.digest());
}
addInput('mode', production ? 'production' : 'development');
for (const output of preliminary.outputFiles) {
  addInput(path.basename(output.path), output.contents);
}
for (const file of [
  'dist/panel.js',
  'dist/panel.css',
  'dist/relay.js',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'scripts/build.mts',
  'media/icon.png',
  'media/comma-gets-a-cure.txt',
  'media/comma-gets-a-cure-notice.txt',
  '../../LICENSE',
]) {
  addInput(file, fs.readFileSync(file));
}
const buildId = hash.digest('hex').slice(0, BUILD_ID_LENGTH);
await esbuild.build({
  ...extensionOptions,
  define: { AI_PAIR_VERSION: JSON.stringify(manifest.version), AI_PAIR_BUILD_ID: JSON.stringify(buildId) },
});
