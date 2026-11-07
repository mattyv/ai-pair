import { beforeEach, expect, it, vi } from 'vitest';
import { resolveBundledHelper } from '../src/helper_manifest';

const mocks = vi.hoisted(() => ({ name: vi.fn(), lstat: vi.fn(), readFile: vi.fn(), digest: vi.fn() }));
vi.mock('../src/helper_location', () => ({ helperFilename: mocks.name }));
vi.mock('node:fs/promises', () => ({ lstat: mocks.lstat, readFile: mocks.readFile }));
vi.mock('node:crypto', () => ({ createHash: () => ({ update: () => ({ digest: mocks.digest }) }) }));
const name = 'audio-darwin-arm64';
const hash = 'a'.repeat(64);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.name.mockReturnValue(name);
  mocks.lstat.mockResolvedValue({ isFile: () => true, size: 100 });
  mocks.readFile.mockImplementation((path: string) =>
    path.endsWith('manifest.json')
      ? Promise.resolve(JSON.stringify({ version: 1, sha256: { [name]: hash } }))
      : Promise.resolve(Buffer.from('binary')),
  );
  mocks.digest.mockReturnValue(hash);
});

it('verifies a fixed helper against its package manifest', async () => {
  await expect(resolveBundledHelper('/root', 'darwin', 'arm64')).resolves.toBe('/root/dist/audio-native/audio-darwin-arm64');
  mocks.digest.mockReturnValue('b'.repeat(64));
  await expect(resolveBundledHelper('/root', 'darwin', 'arm64')).resolves.toBeUndefined();
});

it('rejects untrusted roots, unsupported platforms, and invalid files', async () => {
  await expect(resolveBundledHelper('relative', 'darwin', 'arm64')).resolves.toBeUndefined();
  mocks.name.mockReturnValueOnce(undefined);
  await expect(resolveBundledHelper('/root', 'bad', 'arm64')).resolves.toBeUndefined();
  for (const stat of [
    { isFile: () => false, size: 1 },
    { isFile: () => true, size: 33_554_433 },
  ]) {
    mocks.lstat.mockResolvedValueOnce(stat);
    await expect(resolveBundledHelper('/root', 'darwin', 'arm64')).resolves.toBeUndefined();
  }
  mocks.lstat.mockRejectedValueOnce(new Error('missing'));
  await expect(resolveBundledHelper('/root', 'darwin', 'arm64')).resolves.toBeUndefined();
});

it('rejects malformed manifests and invalid hashes', async () => {
  for (const manifest of [
    'bad json',
    '{}',
    JSON.stringify({ version: 2, sha256: {} }),
    JSON.stringify({ version: 1, sha256: {} }),
    JSON.stringify({ version: 1, sha256: { [name]: 'invalid' } }),
  ]) {
    mocks.readFile.mockResolvedValueOnce(manifest);
    await expect(resolveBundledHelper('/root', 'darwin', 'arm64')).resolves.toBeUndefined();
  }
});
