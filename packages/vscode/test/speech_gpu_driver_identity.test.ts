import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
const fakes = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: fakes.readFile, stat: fakes.stat }));
import { verifyMappedGpuDriver, verifyNoGpuDriver, type DriverIdentityAccess } from '../src/speech_gpu_driver_identity';

const file = '/usr/lib/x86_64-linux-gnu/libvulkan_radeon.so';
const bytes = Buffer.from('trusted radeon');
const identity = { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), device: '2049', inode: '42' };
const mapping = `7f000-80000 r-xp 00000000 08:01 42 ${file}\n`;
function access(maps = mapping): DriverIdentityAccess {
  return {
    maps: () => Promise.resolve(maps),
    stat: () => Promise.resolve({ device: 2049n, inode: 42n }),
    read: () => Promise.resolve(bytes),
  };
}
it('DriverIdentity: accepts only the exact mapped Radeon device, inode and hash', async () => {
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader', access())).toBe(true);

  for (const maps of [
    '',
    mapping.replace(' 42 ', ' 43 '),
    mapping.replace('08:01', '08:02'),
    mapping.replace(file, `${file} (deleted)`),
    `${mapping}${mapping.replace(file, '/tmp/libvulkan_radeon.so')}`,
  ]) {
    expect(await verifyMappedGpuDriver(identity, '/trusted/loader', access(maps))).toBe(false);
  }
  expect(await verifyMappedGpuDriver({ ...identity, sha256: '0'.repeat(64) }, '/trusted/loader', access())).toBe(false);
  expect(await verifyMappedGpuDriver({ ...identity, device: 'wrong' }, '/trusted/loader', access())).toBe(false);
  expect(await verifyMappedGpuDriver({ ...identity, device: '2050' }, '/trusted/loader', access())).toBe(false);
  expect(await verifyMappedGpuDriver({ ...identity, inode: '43' }, '/trusted/loader', access())).toBe(false);
});
it('DriverIdentity: requires no Radeon driver mapping in the invalid-ICD control', async () => {
  expect(await verifyNoGpuDriver('/trusted/loader', access(''))).toBe(true);
  expect(await verifyNoGpuDriver('/trusted/loader', access(mapping))).toBe(false);
  expect(await verifyNoGpuDriver('/trusted/loader', access(mapping.replace(file, `${file} (deleted)`)))).toBe(false);
  const broken = access();
  broken.maps = () => Promise.reject(new Error('private'));
  expect(await verifyNoGpuDriver('/trusted/loader', broken)).toBe(false);
});

it('checks the real child access adapter and bounds driver size', async () => {
  fakes.readFile.mockImplementation((name: string) => Promise.resolve(name === '/proc/self/maps' ? mapping : bytes));
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 14n, dev: 2049n, ino: 42n });
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader')).toBe(true);
  fakes.stat.mockResolvedValue({ isFile: () => false, size: 14n, dev: 2049n, ino: 42n });
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader')).toBe(false);
  fakes.stat.mockResolvedValue({ isFile: () => true, size: 268_435_457n, dev: 2049n, ino: 42n });
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader')).toBe(false);
  fakes.readFile.mockResolvedValue('');
  expect(await verifyNoGpuDriver('/trusted/loader')).toBe(true);
});

it('rejects a renamed extra ICD instead of relying on its filename', async () => {
  const other = '/tmp/other-icd.so';
  const a = access(`${mapping}90000-a0000 r-xp 00000000 08:01 43 ${other}\n`);
  a.read = (name) => Promise.resolve(name === other ? Buffer.from('synthetic ICD') : bytes);
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader', a)).toBe(false);
  expect(await verifyNoGpuDriver('/trusted/loader', a)).toBe(false);
});

it('rejects a mapped driver replaced during inspection', async () => {
  const a = access();
  let calls = 0;
  a.stat = () => Promise.resolve({ device: 2049n, inode: ++calls < 3 ? 42n : 43n });
  expect(await verifyMappedGpuDriver(identity, '/trusted/loader', a)).toBe(false);
});
