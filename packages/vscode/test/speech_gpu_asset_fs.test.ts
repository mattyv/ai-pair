import { beforeEach, expect, it, vi } from 'vitest';
import { gpuAssetFilesystem } from '../src/speech_gpu_asset_fs';

const fakes = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn(), readdir: vi.fn(), stat: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('node:fs/promises', () => ({ lstat: fakes.lstat, open: fakes.open, readdir: fakes.readdir }));
function entry(name: string, kind: 'file' | 'directory' | 'other') {
  return { name, isFile: () => kind === 'file', isDirectory: () => kind === 'directory' };
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.lstat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => false });
  fakes.readdir.mockResolvedValue([entry('file', 'file')]);
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 3 });
  fakes.read.mockImplementation((buffer: Buffer, offset: number) => {
    if (offset > 0) return Promise.resolve({ bytesRead: 0 });
    buffer.write('abc');
    return Promise.resolve({ bytesRead: 3 });
  });
  fakes.close.mockResolvedValue(undefined);
  fakes.open.mockResolvedValue({ stat: fakes.stat, read: fakes.read, close: fakes.close });
});
it('recursively lists regular files and reads the exact bounded size', async () => {
  fakes.readdir.mockImplementation((directory: string) =>
    Promise.resolve(directory === '/root' ? [entry('nested', 'directory')] : [entry('file', 'file')]),
  );
  expect(await gpuAssetFilesystem.list('/root')).toEqual(['nested/file']);
  expect(Buffer.from(await gpuAssetFilesystem.read('/root/file', 3)).toString()).toBe('abc');
  expect(fakes.close).toHaveBeenCalledOnce();
});
it('rejects links, invalid directories and excessive entries', async () => {
  fakes.lstat.mockResolvedValueOnce({ isDirectory: () => false, isSymbolicLink: () => false });
  await expect(gpuAssetFilesystem.list('/root')).rejects.toThrow();
  fakes.lstat.mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => true });
  await expect(gpuAssetFilesystem.list('/root')).rejects.toThrow();
  fakes.readdir.mockResolvedValueOnce([entry('link', 'other')]);
  await expect(gpuAssetFilesystem.list('/root')).rejects.toThrow();
  fakes.readdir.mockResolvedValueOnce(Array.from({ length: 5001 }, (_, index) => entry(String(index), 'file')));
  await expect(gpuAssetFilesystem.list('/root')).rejects.toThrow();
});
it('rejects wrong metadata and file growth while always closing the descriptor', async () => {
  fakes.stat.mockResolvedValueOnce({ isFile: () => false, size: 3 });
  await expect(gpuAssetFilesystem.read('/root/file', 3)).rejects.toThrow();
  fakes.read.mockImplementationOnce((buffer: Buffer) => {
    buffer.write('abcd');
    return Promise.resolve({ bytesRead: 4 });
  });
  await expect(gpuAssetFilesystem.read('/root/file', 3)).rejects.toThrow();
  expect(fakes.close).toHaveBeenCalledTimes(2);
});
