import { expect, it } from 'vitest';

/** Minimal ELF64 with a dynamic symbol and its linked string table. */
function elf(symbol: string, defined = true, binding = 1): Buffer {
  const bytes = Buffer.alloc(1024);
  bytes.writeUInt32BE(0x7f454c46, 0);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(2, 56);
  bytes.writeUInt32LE(1, 64);
  bytes.writeBigUInt64LE(1024n, 64 + 32);
  bytes.writeUInt32LE(2, 120);
  bytes.writeBigUInt64LE(256n, 120 + 8);
  bytes.writeBigUInt64LE(256n, 120 + 16);
  bytes.writeBigUInt64LE(96n, 120 + 32);
  const tags = [
    [6, 512],
    [5, 600],
    [10, 128],
    [11, 24],
    [4, 800],
    [0, 0],
  ];
  tags.forEach(([tag, value], i) => {
    bytes.writeBigUInt64LE(BigInt(tag ?? 0), 256 + i * 16);
    bytes.writeBigUInt64LE(BigInt(value ?? 0), 264 + i * 16);
  });
  bytes.writeUInt32LE(1, 512);
  bytes[516] = binding << 4;
  bytes.writeUInt16LE(defined ? 1 : 0, 518);
  bytes.write(symbol, 601);
  bytes.writeUInt32LE(1, 800);
  bytes.writeUInt32LE(1, 804);
  return bytes;
}

it('Safe, NegativeSafe: rejects a valid ICD mapped under an unrelated filename', async () => {
  const { createHash } = await import('node:crypto');
  const { verifyMappedGpuDriver, verifyNoGpuDriver } = await import('../src/speech_gpu_driver_identity');
  const trusted = elf('vk_icdGetInstanceProcAddr');
  const innocent = elf('ordinary_symbol');
  const renamed = elf('vk_icdGetInstanceProcAddr');
  const maps = '1000-2000 r-xp 0 08:01 42 /driver.so\n2000-3000 r-xp 0 08:01 43 /other-icd.so\n';
  const access = {
    maps: () => Promise.resolve(maps),
    stat: (name: string) => Promise.resolve({ device: 2049n, inode: name === '/driver.so' ? 42n : 43n }),
    read: (name: string) => Promise.resolve(name === '/driver.so' ? trusted : renamed),
  };
  const identity = { path: '/driver.so', sha256: createHash('sha256').update(trusted).digest('hex'), device: '2049', inode: '42' };
  expect(await verifyMappedGpuDriver(identity, '/loader.so', access)).toBe(false);
  expect(await verifyNoGpuDriver('/loader.so', access)).toBe(false);
  access.read = (name) => Promise.resolve(name === '/driver.so' ? trusted : innocent);
  expect(await verifyMappedGpuDriver(identity, '/loader.so', access)).toBe(true);
});
