/* ELF ABI offsets, tags, and sizes are fixed by the binary format. */
/* oxlint-disable eslint/no-magic-numbers */
/** Inspects loader-visible defined symbols without loading the mapped object. */
export function hasGpuIcdExports(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function check(offset: number, size: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length) {
      throw new Error('Invalid mapped ELF.');
    }
  }
  function u64(offset: number): number {
    return Number(view.getBigUint64(offset, true));
  }
  check(0, 64);
  if (view.getUint32(0, false) !== 0x7f454c46 || view.getUint8(4) !== 2 || view.getUint8(5) !== 1) throw new Error('Unsupported mapped ELF.');
  const phoff = u64(32);
  const phsize = view.getUint16(54, true);
  const phcount = view.getUint16(56, true);
  if (phsize !== 56 || phcount === 0 || phcount > 4096) throw new Error('Invalid ELF segments.');
  check(phoff, phsize * phcount);
  const loads: Array<{ addr: number; offset: number; size: number }> = [];
  let dynamic: { offset: number; size: number; addr: number } | undefined;
  for (let i = 0; i < phcount; i += 1) {
    const at = phoff + i * phsize;
    const type = view.getUint32(at, true);
    if (type !== 1 && type !== 2) continue;
    const offset = u64(at + 8);
    const addr = u64(at + 16);
    const size = u64(at + 32);
    check(offset, size);
    if (!Number.isSafeInteger(addr)) throw new Error('Invalid ELF address.');
    if (type === 1) loads.push({ addr, offset, size });
    else {
      if (dynamic !== undefined) throw new Error('Ambiguous ELF dynamic segments.');
      dynamic = { offset, size, addr };
    }
  }
  function translate(addr: number, size: number): number {
    const matches = loads.filter((segment) => addr >= segment.addr && addr + size <= segment.addr + segment.size);
    if (matches.length !== 1 || matches[0] === undefined) throw new Error('Invalid ELF address.');
    const offset = matches[0].offset + addr - matches[0].addr;
    check(offset, size);
    return offset;
  }
  if (dynamic === undefined || dynamic.size % 16 !== 0 || dynamic.size > 1_048_576 ||
      translate(dynamic.addr, dynamic.size) !== dynamic.offset) throw new Error('Missing ELF dynamic segment.');
  const tags = new Map<number, number>();
  let terminated = false;
  for (let at = dynamic.offset; at < dynamic.offset + dynamic.size; at += 16) {
    const tag = u64(at);
    const value = u64(at + 8);
    if (tag === 0) { terminated = true; break; }
    if ([4, 5, 6, 10, 11, 0x6ffffef5].includes(tag)) {
      if (tags.has(tag) || !Number.isSafeInteger(value)) throw new Error('Ambiguous ELF dynamic tags.');
      tags.set(tag, value);
    }
  }
  const symaddr = tags.get(6); const straddr = tags.get(5); const strsize = tags.get(10);
  if (!terminated || symaddr === undefined || straddr === undefined || strsize === undefined || tags.get(11) !== 24 || strsize === 0) throw new Error('Invalid ELF dynamic tables.');
  const strings = translate(straddr, strsize);
  let count: number | undefined;
  const hash = tags.get(4);
  if (hash !== undefined) {
    const at = translate(hash, 8);
    const buckets = view.getUint32(at, true); count = view.getUint32(at + 4, true);
    if (buckets === 0 || count === 0 || count > 1_000_000 || buckets > 1_000_000) throw new Error('Invalid ELF hash.');
    const table = translate(hash, 8 + 4 * (buckets + count));
    for (let i = 0; i < buckets + count; i += 1) {
      if (view.getUint32(table + 8 + i * 4, true) >= count) throw new Error('Invalid ELF hash index.');
    }
  }
  const gnu = tags.get(0x6ffffef5);
  if (gnu !== undefined) {
    const at = translate(gnu, 16);
    const buckets = view.getUint32(at, true); const first = view.getUint32(at + 4, true);
    const bloom = view.getUint32(at + 8, true);
    if (buckets === 0 || buckets > 1_000_000 || bloom === 0 || bloom > 1_000_000 || first > 1_000_000) throw new Error('Invalid ELF GNU hash.');
    const bucketAddr = gnu + 16 + bloom * 8;
    const bucketOffset = translate(bucketAddr, buckets * 4);
    const chainAddr = bucketAddr + buckets * 4;
    let maximum = first;
    let chainSteps = 0;
    for (let i = 0; i < buckets; i += 1) {
      let index = view.getUint32(bucketOffset + i * 4, true);
      if (index === 0) continue;
      if (index < first || index > 1_000_000) throw new Error('Invalid ELF GNU bucket.');
      for (;;) {
        chainSteps += 1;
        if (index >= 1_000_000 || chainSteps > 1_000_000) throw new Error('Invalid ELF GNU chain.');
        const chain = translate(chainAddr + (index - first) * 4, 4);
        maximum = Math.max(maximum, index + 1);
        index += 1;
        if ((view.getUint32(chain, true) & 1) !== 0) break;
      }
    }
    if (count !== undefined && maximum > count) throw new Error('Conflicting ELF hashes.');
    count ??= maximum;
  }
  if (count === undefined || count === 0) throw new Error('Missing ELF hash.');
  const symbols = translate(symaddr, count * 24);
  let nameBytes = 0;
  for (let i = 0; i < count; i += 1) {
    const at = symbols + i * 24;
    const name = view.getUint32(at, true); const binding = view.getUint8(at + 4) >> 4;
    const visibility = view.getUint8(at + 5) & 3; const defined = view.getUint16(at + 6, true) !== 0;
    if (!defined) continue;
    void binding; void visibility;
    if (name >= strsize) throw new Error('Invalid ELF symbol name.');
    const begin = strings + name; let end = begin;
    while (end < strings + strsize && bytes[end] !== 0) {
      end += 1;
      nameBytes += 1;
      if (nameBytes > 16_777_216) throw new Error('ELF symbol names too large.');
    }
    if (end === strings + strsize) throw new Error('Invalid ELF symbol name.');
    const symbol = Buffer.from(bytes.subarray(begin, end)).toString('utf8');
    if (symbol === 'vk_icdGetInstanceProcAddr' || symbol === 'vk_icdNegotiateLoaderICDInterfaceVersion' || symbol === 'vkGetInstanceProcAddr') return true;
  }
  return false;
}
