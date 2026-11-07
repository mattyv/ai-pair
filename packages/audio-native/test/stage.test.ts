import { beforeEach, expect, it, vi } from 'vitest';
import { stageAssets } from '../src/stage';

const mocks = vi.hoisted(() => ({ lstat: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), chmod: vi.fn(), hash: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  lstat: mocks.lstat,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  chmod: mocks.chmod,
}));
vi.mock('node:crypto', () => ({ createHash: () => ({ update: () => ({ digest: mocks.hash }) }) }));
const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lstat.mockRejectedValue(missing);
  mocks.readFile.mockResolvedValue(Buffer.from('binary'));
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.chmod.mockResolvedValue(undefined);
  mocks.hash.mockReturnValue('digest');
});

it('stages an allowed development artifact and writes a digest manifest', async () => {
  mocks.lstat.mockImplementation((path: string) =>
    path.endsWith('audio-darwin-x64') ? Promise.resolve({ isFile: () => true, size: 6 }) : Promise.reject(missing),
  );
  await stageAssets('/source', '/companion');
  expect(mocks.readFile).toHaveBeenCalledOnce();
  expect(mocks.chmod).toHaveBeenCalledOnce();
  expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  expect(mocks.writeFile.mock.calls.at(-1)?.[1]).toContain('audio-darwin-x64');
});

it('requires all four binaries for universal release and rejects no artifacts', async () => {
  await expect(stageAssets('/source', '/companion')).rejects.toThrow();
  mocks.lstat.mockResolvedValue({ isFile: () => true, size: 6 });
  await stageAssets('/source', '/companion', true);
  expect(mocks.chmod).toHaveBeenCalledTimes(4);
  mocks.lstat.mockImplementation((path: string) =>
    path.endsWith('audio-darwin-x64') ? Promise.resolve({ isFile: () => true, size: 6 }) : Promise.reject(missing),
  );
  await expect(stageAssets('/source', '/companion', true)).rejects.toThrow();
});

it('rejects non-files, empty or oversized artifacts and real IO errors', async () => {
  for (const stat of [
    { isFile: () => false, size: 1 },
    { isFile: () => true, size: 0 },
    { isFile: () => true, size: 33_554_433 },
  ]) {
    mocks.lstat.mockResolvedValueOnce(stat);
    await expect(stageAssets('/source', '/companion')).rejects.toThrow();
  }
  mocks.lstat.mockRejectedValueOnce(new Error('permission'));
  await expect(stageAssets('/source', '/companion')).rejects.toThrow('permission');
});
