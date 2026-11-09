import { beforeEach, expect, it, vi } from 'vitest';
import { systemGpuDriver, systemGpuLoader } from '../src/speech_gpu_system';

const fakes = vi.hoisted(() => ({
  select: vi.fn(),
  driver: vi.fn(),
  trust: vi.fn(),
  realpath: vi.fn(),
  readlink: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
}));
vi.mock('../src/speech_gpu_driver', () => ({ findGpuDriver: fakes.driver }));
vi.mock('../src/speech_gpu_loader_allowlist', () => ({ trustedGpuLoader: fakes.select }));
vi.mock('../src/speech_gpu_trust', () => ({ trustedSystemPath: fakes.trust }));
vi.mock('node:fs/promises', () => ({
  realpath: fakes.realpath,
  readlink: fakes.readlink,
  lstat: fakes.lstat,
  stat: fakes.stat,
  readFile: fakes.read,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('passes real path, ownership and bounded content operations to loader selection', async () => {
  fakes.select.mockImplementation(
    async (access: {
      realpath: (x: string) => Promise<string>;
      trusted: (x: string) => Promise<boolean>;
      hash: (x: string) => Promise<string>;
    }) => {
      await access.realpath('/loader');
      await access.trusted('/loader');
      await access.hash('/loader');
      return undefined;
    },
  );
  fakes.realpath.mockResolvedValue('/loader');
  fakes.trust.mockResolvedValue(true);
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 3 });
  fakes.read.mockResolvedValue(Buffer.from('abc'));
  expect(await systemGpuLoader()).toBeUndefined();
  expect(fakes.realpath).toHaveBeenCalledWith('/loader');
  expect(fakes.trust).toHaveBeenCalledOnce();
  expect(fakes.read).toHaveBeenCalledWith('/loader');
});
it('refuses an oversized or non-file loader before reading it', async () => {
  fakes.select.mockImplementation(async (access: { hash: (x: string) => Promise<string> }) => {
    await access.hash('/loader');
  });
  fakes.stat.mockResolvedValue({ isFile: () => false, size: 3 });
  await expect(systemGpuLoader()).rejects.toThrow();
  expect(fakes.read).not.toHaveBeenCalled();
});

it('uses bounded trusted reads when selecting a Radeon driver', async () => {
  fakes.driver.mockImplementation(async (access: { trusted: (x: string) => Promise<boolean>; read: (x: string) => Promise<string> }) => {
    await access.trusted('/driver');
    await access.read('/driver');
    return '/driver';
  });
  fakes.trust.mockResolvedValue(true);
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 3 });
  fakes.read.mockResolvedValue(Buffer.from('abc'));
  expect(await systemGpuDriver()).toBe('/driver');
});

it('passes actual ownership and symlink metadata into path trust checks', async () => {
  fakes.select.mockImplementation(async (access: { trusted: (file: string) => Promise<boolean> }) => {
    await access.trusted('/loader');
    return undefined;
  });
  fakes.trust.mockImplementation(async (file: string, access: { lstat: (file: string) => Promise<unknown> }) => {
    expect(file).toBe('/loader');
    expect(await access.lstat('/loader')).toEqual({ uid: 0, mode: 0o755, symlink: true });
    return true;
  });
  fakes.lstat.mockResolvedValue({ uid: 0, mode: 0o755, isSymbolicLink: () => true });
  await systemGpuLoader();
});

it('rejects oversized or invalid system driver manifests', async () => {
  fakes.driver.mockImplementation(async (access: { read: (file: string) => Promise<string> }) => {
    await access.read('/driver');
  });
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 65_537 });
  await expect(systemGpuDriver()).rejects.toThrow();
  expect(fakes.read).not.toHaveBeenCalled();
});

it('captures driver hash, device and inode from a stable regular system file', async () => {
  fakes.driver.mockImplementation(async (access: { identity: (file: string) => Promise<unknown> }) => access.identity('/driver'));
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 3n, dev: 2049n, ino: 42n });
  fakes.read.mockResolvedValue(Buffer.from('abc'));
  expect(await systemGpuDriver()).toEqual({
    path: '/driver',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    device: '2049',
    inode: '42',
  });
});

it('rejects non-files, oversized drivers and identity changes during hashing', async () => {
  fakes.driver.mockImplementation(async (access: { identity: (file: string) => Promise<unknown> }) => access.identity('/driver'));
  fakes.stat.mockResolvedValueOnce({ isFile: () => false, size: 3n, dev: 1n, ino: 2n });
  await expect(systemGpuDriver()).rejects.toThrow();
  fakes.stat.mockResolvedValueOnce({ isFile: () => true, size: 268_435_457n, dev: 1n, ino: 2n });
  await expect(systemGpuDriver()).rejects.toThrow();
  fakes.read.mockResolvedValue(Buffer.from('abc'));
  fakes.stat
    .mockResolvedValueOnce({ isFile: () => true, size: 3n, dev: 1n, ino: 2n })
    .mockResolvedValueOnce({ size: 3n, dev: 1n, ino: 3n });
  await expect(systemGpuDriver()).rejects.toThrow();
});
