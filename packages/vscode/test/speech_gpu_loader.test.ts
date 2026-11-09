import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: fakes.readFile, stat: fakes.stat }));
import { verifyMappedVulkanLoader, type LoaderAccess } from '../src/speech_gpu_loader';

const file = '/usr/lib/x86_64-linux-gnu/libvulkan.so.1.4.309';
const bytes = Buffer.from('trusted loader');
const hash = createHash('sha256').update(bytes).digest('hex');
const line = `7f000-80000 r-xp 00000000 08:01 42 ${file}\n`;
function access(maps = line): LoaderAccess {
  return {
    maps: () => Promise.resolve(maps),
    stat: () => Promise.resolve({ device: 0x801n, inode: 42n }),
    read: () => Promise.resolve(bytes),
  };
}

it('accepts the one mapped loader with matching path, inode, device and hash', async () => {
  expect(await verifyMappedVulkanLoader(file, hash, access())).toBe(true);
});

it('rejects absent, replaced, ambiguous, deleted or untrusted loader evidence', async () => {
  for (const maps of [
    '',
    line.replace(' 42 ', ' 43 '),
    line.replace('08:01', '08:02'),
    `${line}${line.replace(file, '/tmp/libvulkan.so.1')}`,
    line.replace(file, `${file} (deleted)`),
    line.replace(file, '/tmp/libvulkan.so.1'),
  ]) {
    expect(await verifyMappedVulkanLoader(file, hash, access(maps))).toBe(false);
  }
  expect(await verifyMappedVulkanLoader(file, '0'.repeat(64), access())).toBe(false);
  expect(await verifyMappedVulkanLoader('relative.so', hash, access())).toBe(false);
  const broken = access();
  broken.maps = () => Promise.reject(new Error('private'));
  expect(await verifyMappedVulkanLoader(file, hash, broken)).toBe(false);
});

it('checks the real child access adapter with bounded loader bytes', async () => {
  fakes.readFile.mockImplementation((name: string) => Promise.resolve(name === '/proc/self/maps' ? line : bytes));
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 14n, dev: 0x801n, ino: 42n });
  expect(await verifyMappedVulkanLoader(file, hash)).toBe(true);
  fakes.stat.mockResolvedValue({ isFile: () => false, size: 14n, dev: 0x801n, ino: 42n });
  expect(await verifyMappedVulkanLoader(file, hash)).toBe(false);
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 16_777_217n, dev: 0x801n, ino: 42n });
  expect(await verifyMappedVulkanLoader(file, hash)).toBe(false);
});
