import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NAMES = ['audio-darwin-x64', 'audio-darwin-arm64', 'audio-win32-x64.exe', 'audio-win32-arm64.exe'] as const;
const MAX_BINARY = 33_554_432;
const EXECUTABLE_MODE = 0o755;

/** Stages only fixed helper artifacts and writes a deterministic digest manifest. */
export async function stageAssets(source: string, extensionRoot: string, universal = false): Promise<void> {
  const artifacts: Array<{ name: string; data: Buffer }> = [];
  for (const name of NAMES) {
    const path = join(source, name);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BINARY) throw new Error('Invalid native helper artifact.');
    artifacts.push({ name, data: await readFile(path) });
  }
  if (artifacts.length === 0 || (universal && artifacts.length !== NAMES.length)) {
    throw new Error('Required native helper artifacts are missing.');
  }
  const destination = join(extensionRoot, 'dist', 'audio-native');
  await mkdir(destination, { recursive: true });
  const sha256: Record<string, string> = {};
  for (const artifact of artifacts) {
    const path = join(destination, artifact.name);
    await writeFile(path, artifact.data);
    await chmod(path, EXECUTABLE_MODE);
    sha256[artifact.name] = createHash('sha256').update(artifact.data).digest('hex');
  }
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify({ version: 1, sha256 }, undefined, 2)}\n`);
}
