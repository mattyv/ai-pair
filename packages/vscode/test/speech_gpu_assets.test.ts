import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { verifyGpuAssets, type GpuAssetAccess } from '../src/speech_gpu_assets';

it('verifies each fixed asset by path, length and SHA-256', async () => {
  const bytes = Buffer.from('runtime');
  const access: GpuAssetAccess = { read: vi.fn().mockResolvedValue(bytes), list: vi.fn().mockResolvedValue(['node_modules/example.js']) };
  const asset = { path: 'node_modules/example.js', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  expect(await verifyGpuAssets('/gpu/runtime', [asset], access)).toBe(true);
  expect(access.read).toHaveBeenCalledWith('/gpu/runtime/node_modules/example.js', bytes.length);
  expect(await verifyGpuAssets('/gpu/runtime', [{ ...asset, sha256: '0'.repeat(64) }], access)).toBe(false);
  expect(await verifyGpuAssets('/gpu/runtime', [{ ...asset, size: bytes.length + 1 }], access)).toBe(false);
});

it('rejects traversal, duplicate paths, missing files and malformed digests', async () => {
  const access: GpuAssetAccess = { read: vi.fn().mockRejectedValue(new Error('private path')), list: vi.fn().mockResolvedValue(['ok']) };
  const asset = { path: 'ok', size: 1, sha256: 'a'.repeat(64) };
  for (const assets of [
    [{ ...asset, path: '../secret' }],
    [{ ...asset, path: '/absolute' }],
    [asset, asset],
    [{ ...asset, sha256: 'bad' }],
    [asset],
  ]) {
    expect(await verifyGpuAssets('/gpu/runtime', assets, access)).toBe(false);
  }
});

it('rejects unlisted and missing files before trusting the runtime', async () => {
  const bytes = Buffer.from('runtime');
  const asset = { path: 'example.js', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const access: GpuAssetAccess = {
    read: vi.fn().mockResolvedValue(bytes),
    list: vi.fn().mockResolvedValue(['example.js', 'unexpected.js']),
  };
  expect(await verifyGpuAssets('/gpu/runtime', [asset], access)).toBe(false);
  vi.mocked(access.list).mockResolvedValue([]);
  expect(await verifyGpuAssets('/gpu/runtime', [asset], access)).toBe(false);
});

it('rejects an empty asset manifest before reading the runtime', async () => {
  const access: GpuAssetAccess = { list: vi.fn(), read: vi.fn() };
  expect(await verifyGpuAssets('/gpu/runtime', [], access)).toBe(false);
  expect(access.list).not.toHaveBeenCalled();
  expect(access.read).not.toHaveBeenCalled();
});
