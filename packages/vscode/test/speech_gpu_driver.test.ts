import { expect, it, vi } from 'vitest';
import { findGpuDriver, type GpuDriverAccess } from '../src/speech_gpu_driver';

const library = '/usr/lib/x86_64-linux-gnu/libvulkan_radeon.so';
const identity = { path: library, sha256: 'a'.repeat(64), device: '2049', inode: '42' };
function access(): GpuDriverAccess {
  return {
    trusted: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(`{"ICD":{"library_path":"${library}"}}`),
    realpath: vi.fn().mockResolvedValue(library),
    identity: vi.fn().mockResolvedValue(identity),
  };
}
it('accepts trusted fixed absolute and stock bare Radeon manifests with immutable identity', async () => {
  const fs = access();
  expect(await findGpuDriver(fs)).toEqual({ manifest: '/usr/share/vulkan/icd.d/radeon_icd.x86_64.json', identity });
  vi.mocked(fs.read).mockResolvedValue('{"ICD":{"library_path":"libvulkan_radeon.so"}}');
  expect(await findGpuDriver(fs)).toEqual({ manifest: '/usr/share/vulkan/icd.d/radeon_icd.x86_64.json', identity });
  expect(fs.trusted).toHaveBeenCalledWith(library);
});
it('rejects untrusted, substituted, malformed and missing driver evidence', async () => {
  const untrusted = access();
  vi.mocked(untrusted.trusted).mockResolvedValue(false);
  expect(await findGpuDriver(untrusted)).toBeUndefined();
  const altered = access();
  vi.mocked(altered.read).mockResolvedValue('{"ICD":{"library_path":"/tmp/evil.so"}}');
  expect(await findGpuDriver(altered)).toBeUndefined();
  const missing = access();
  vi.mocked(missing.read).mockRejectedValue(new Error('private'));
  expect(await findGpuDriver(missing)).toBeUndefined();
  const identityMismatch = access();
  vi.mocked(identityMismatch.identity).mockResolvedValue({ ...identity, path: '/tmp/evil' });
  expect(await findGpuDriver(identityMismatch)).toBeUndefined();
  const malformed = access();
  vi.mocked(malformed.identity).mockResolvedValue({ ...identity, sha256: 'bad' });
  expect(await findGpuDriver(malformed)).toBeUndefined();
});

it('rejects untrusted canonical targets and skips untrusted manifests', async () => {
  const relative = access();
  vi.mocked(relative.realpath).mockResolvedValue('relative');
  expect(await findGpuDriver(relative)).toBeUndefined();
  const target = access();
  vi.mocked(target.trusted).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await findGpuDriver(target)).toBeUndefined();
  const manifest = access();
  vi.mocked(manifest.trusted).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
  expect(await findGpuDriver(manifest)).toBeUndefined();
});
