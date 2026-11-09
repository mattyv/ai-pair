import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { gpuManifest } from './gpu_manifest.mts';

const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock('node:fs', () => ({ readdirSync: mocks.list, readFileSync: mocks.read }));

it('hashes staged regular files in stable path order', () => {
  mocks.list.mockReturnValue([
    { name: 'b', isFile: () => true, isDirectory: () => false },
    { name: 'a', isFile: () => true, isDirectory: () => false },
  ]);
  mocks.read.mockImplementation((file: string) => Buffer.from(file.endsWith('/a') ? 'a' : 'b'));
  expect(gpuManifest('/gpu')).toEqual(
    ['a', 'b'].map((name) => ({ path: name, size: 1, sha256: createHash('sha256').update(name).digest('hex') })),
  );
});
it('rejects symlinks and other unexpected staged entries', () => {
  mocks.list.mockReturnValue([{ name: 'link', isFile: () => false, isDirectory: () => false }]);
  expect(() => gpuManifest('/gpu')).toThrow();
});
