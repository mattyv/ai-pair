import { expect, it } from 'vitest';
import { hasGpuIcdExports } from '../src/speech_gpu_elf';

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

it.each(['vk_icdGetInstanceProcAddr', 'vk_icdNegotiateLoaderICDInterfaceVersion', 'vkGetInstanceProcAddr'])(
  'detects the defined export %s',
  (symbol) => {
    expect(hasGpuIcdExports(elf(symbol))).toBe(true);
    expect(hasGpuIcdExports(elf(symbol, false))).toBe(false);
    expect(hasGpuIcdExports(elf(symbol, true, 10))).toBe(true);
  },
);
it('accepts unrelated objects and fails closed on malformed ELF', () => {
  expect(hasGpuIcdExports(elf('ordinary_symbol'))).toBe(false);
  expect(() => hasGpuIcdExports(Buffer.from('invalid'))).toThrow();
  const broken = elf('ordinary_symbol');
  broken.writeBigUInt64LE(999_999n, 32);
  expect(() => hasGpuIcdExports(broken)).toThrow();
});

it('detects loader-visible symbols when section metadata is hidden', () => {
  const hidden = elf('vk_icdGetInstanceProcAddr');
  hidden.writeBigUInt64LE(0n, 40);
  expect(hasGpuIcdExports(hidden)).toBe(true);
});

it('rejects a SysV hash bucket outside the declared symbol count', () => {
  const hidden = elf('vk_icdGetInstanceProcAddr');
  hidden.writeUInt32LE(2, 808);
  expect(() => hasGpuIcdExports(hidden)).toThrow();
});

it('uses GNU hash buckets to bound loader-visible symbols', () => {
  const data = elf('vk_icdGetInstanceProcAddr');
  data.writeBigUInt64LE(0x6ffffef5n, 320);
  data.writeUInt32LE(1, 800); // one bucket
  data.writeUInt32LE(1, 804); // first symbol
  data.copy(data, 536, 512, 536);
  data.fill(0, 512, 536);
  data.writeUInt32LE(1, 808); // one bloom word
  data.writeUInt32LE(0, 824); // bucket points at symbol zero (empty)
  expect(hasGpuIcdExports(data)).toBe(false);
  data.writeUInt32LE(1, 824); // bucket points to symbol one
  data.writeUInt32LE(1, 832); // terminating chain
  expect(hasGpuIcdExports(data)).toBe(true);
});

it('Safe, NegativeSafe: rejects malformed loader tables and ambiguous mapped segments', () => {
  const cases: Array<(data: Buffer) => void> = [
    (data) => {
      data[0] = 0;
    },
    (data) => {
      data[4] = 1;
    },
    (data) => {
      data[5] = 2;
    },
    (data) => {
      data.writeUInt16LE(0, 54);
    },
    (data) => {
      data.writeUInt16LE(0, 56);
    },
    (data) => {
      data.writeBigUInt64LE(2n ** 60n, 64 + 16);
    },
    (data) => {
      data.writeUInt32LE(0, 120);
    },
    (data) => {
      data.writeBigUInt64LE(257n, 120 + 16);
    },
    (data) => {
      data.writeBigUInt64LE(95n, 120 + 32);
    },
    (data) => {
      data.writeBigUInt64LE(6n, 272);
    },
    (data) => {
      data.writeBigUInt64LE(2n ** 60n, 264);
    },
    (data) => {
      data.writeBigUInt64LE(1n, 336);
    },
    (data) => {
      data.writeBigUInt64LE(0n, 296);
    },
    (data) => {
      data.writeBigUInt64LE(8n, 312);
    },
    (data) => {
      data.writeBigUInt64LE(3n, 320);
    },
    (data) => {
      data.writeUInt32LE(0, 800);
    },
    (data) => {
      data.writeUInt32LE(0, 804);
    },
    (data) => {
      data.writeUInt32LE(128, 512);
    },
    (data) => {
      data.fill(65, 601, 728);
    },
  ];
  for (const [index, mutate] of cases.entries()) {
    const data = elf('ordinary_symbol');
    mutate(data);
    expect(() => hasGpuIcdExports(data), `case ${index}`).toThrow();
  }
});

it('Safe, NegativeSafe: bounds malformed GNU hashes and symbol names', () => {
  function gnu(): Buffer {
    const data = elf('ordinary_symbol');
    data.writeBigUInt64LE(0x6ffffef5n, 320);
    data.writeUInt32LE(1, 800);
    data.writeUInt32LE(1, 804);
    data.writeUInt32LE(1, 808);
    return data;
  }
  for (const mutate of [
    (data: Buffer) => {
      data.writeUInt32LE(0, 800);
    },
    (data: Buffer) => {
      data.writeUInt32LE(0, 808);
    },
    (data: Buffer) => {
      data.writeUInt32LE(2, 804);
      data.writeUInt32LE(1, 824);
    },
    (data: Buffer) => {
      data.writeUInt32LE(1_000_000, 824);
    },
  ]) {
    const data = gnu();
    mutate(data);
    expect(() => hasGpuIcdExports(data)).toThrow();
  }
  const tooLong = Buffer.alloc(16_779_000, 65);
  elf('ordinary_symbol').copy(tooLong);
  tooLong.writeBigUInt64LE(BigInt(tooLong.length), 64 + 32);
  tooLong.writeBigUInt64LE(BigInt(tooLong.length - 600), 296);
  tooLong.writeBigUInt64LE(400n, 328);
  tooLong.writeUInt32LE(1, 400);
  tooLong.writeUInt32LE(1, 404);
  tooLong.writeUInt32LE(0, 408);
  tooLong.writeUInt32LE(0, 412);
  tooLong.fill(65, 601);
  expect(() => hasGpuIcdExports(tooLong)).toThrow();
});

it('Safe, NegativeSafe: rejects duplicate segments and inconsistent hash tables', () => {
  const duplicateDynamic = elf('ordinary_symbol');
  duplicateDynamic.writeUInt16LE(3, 56);
  duplicateDynamic.writeUInt32LE(2, 176);
  expect(() => hasGpuIcdExports(duplicateDynamic)).toThrow();
  const overlap = elf('ordinary_symbol');
  overlap.writeUInt16LE(3, 56);
  overlap.writeUInt32LE(1, 176);
  overlap.writeBigUInt64LE(1024n, 176 + 32);
  expect(() => hasGpuIcdExports(overlap)).toThrow();
  const both = elf('ordinary_symbol');
  both.writeBigUInt64LE(112n, 120 + 32);
  both.writeBigUInt64LE(0x6ffffef5n, 336);
  both.writeBigUInt64LE(840n, 344);
  both.writeBigUInt64LE(0n, 352);
  both.writeBigUInt64LE(0n, 360);
  both.writeUInt32LE(1, 840);
  both.writeUInt32LE(1, 844);
  both.writeUInt32LE(1, 848);
  expect(hasGpuIcdExports(both)).toBe(false);
  both.writeUInt32LE(1, 864);
  both.writeUInt32LE(1, 868);
  expect(() => hasGpuIcdExports(both)).toThrow();
});
