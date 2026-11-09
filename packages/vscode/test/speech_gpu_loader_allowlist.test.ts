import { expect, it, vi } from 'vitest';
import { trustedGpuLoader, type GpuLoaderAccess } from '../src/speech_gpu_loader_allowlist';

const ubuntu = '/usr/lib/x86_64-linux-gnu/libvulkan.so.1.3.275';
const ubuntuHash = 'e833b010f814b72c6aca0300c8b5f19b6106ffa06c24ddc95a293970c7d6058e';
function access(): GpuLoaderAccess {
  return {
    realpath: vi.fn().mockResolvedValue(ubuntu),
    trusted: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue(ubuntuHash),
  };
}
it('accepts only an exact vetted loader with trusted link and target', async () => {
  const fs = access();
  expect(await trustedGpuLoader(fs)).toEqual({ path: ubuntu, sha256: ubuntuHash });
  expect(fs.trusted).toHaveBeenCalledWith('/usr/lib/x86_64-linux-gnu/libvulkan.so.1');
  expect(fs.trusted).toHaveBeenCalledWith(ubuntu);
});
it('rejects unknown, modified, untrusted or unreadable loaders', async () => {
  const unknown = access();
  vi.mocked(unknown.realpath).mockResolvedValue('/tmp/libvulkan.so.1');
  expect(await trustedGpuLoader(unknown)).toBeUndefined();
  const modified = access();
  vi.mocked(modified.hash).mockResolvedValue('0'.repeat(64));
  expect(await trustedGpuLoader(modified)).toBeUndefined();
  const untrusted = access();
  vi.mocked(untrusted.trusted).mockResolvedValue(false);
  expect(await trustedGpuLoader(untrusted)).toBeUndefined();
  const missing = access();
  vi.mocked(missing.realpath).mockRejectedValue(new Error('private'));
  expect(await trustedGpuLoader(missing)).toBeUndefined();
});

it('accepts the verified Ubuntu 26.04 loader package content', async () => {
  const fs = access();
  vi.mocked(fs.realpath).mockResolvedValue('/usr/lib/x86_64-linux-gnu/libvulkan.so.1.4.341');
  vi.mocked(fs.hash).mockResolvedValue('def4af45e9e5784cf65eaaaa289530a5c73546b01015da4c0920ef0a144fe189');
  expect(await trustedGpuLoader(fs)).toEqual({
    path: '/usr/lib/x86_64-linux-gnu/libvulkan.so.1.4.341',
    sha256: 'def4af45e9e5784cf65eaaaa289530a5c73546b01015da4c0920ef0a144fe189',
  });
});
