import { expect, it, vi } from 'vitest';
import { VerifiedBackend } from '../src/verified_backend';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), start: vi.fn(), list: vi.fn(), identities: [] as string[] }));
vi.mock('../src/helper_manifest', () => ({ resolveBundledHelper: mocks.resolve }));
vi.mock('../src/helper_backend', () => ({
  HelperBackend: class {
    constructor(
      path: string,
      private readonly identity: string,
    ) {
      expect(path).toContain('/dist/audio-native/');
      mocks.identities.push(identity);
    }
    list = mocks.list;
    start = mocks.start;
    capabilities() {
      return Promise.resolve({ backend: this.identity, location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
    }
    defaultId() {
      return Promise.resolve('a');
    }
  },
}));

it('does not report helper support or launch when the packaged executable fails verification', async () => {
  mocks.resolve.mockResolvedValueOnce(undefined);
  const backend = new VerifiedBackend('/trusted/root', 'darwin', 'arm64');
  expect(await backend.capabilities()).toMatchObject({ defaultOutput: false, deviceSelection: false });
  expect(await backend.list()).toEqual([]);
  expect(() => backend.start('a', new Uint8Array(44), vi.fn<(...args: unknown[]) => void>())).toThrow();
  expect(mocks.start).not.toHaveBeenCalled();
});

it('uses the verified helper for discovery and playback', async () => {
  mocks.resolve.mockResolvedValueOnce('/trusted/root/dist/audio-native/audio-darwin-arm64');
  mocks.list.mockResolvedValueOnce([{ id: 'a', label: 'A' }]);
  mocks.start.mockReturnValueOnce({ closed: Promise.resolve(), stop: vi.fn() });
  const backend = new VerifiedBackend('/trusted/root', 'darwin', 'arm64');
  expect(await backend.list()).toEqual([{ id: 'a', label: 'A' }]);
  backend.start('a', new Uint8Array(44), vi.fn<(...args: unknown[]) => void>());
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it('returns the concrete default only for a verified helper', async () => {
  mocks.resolve.mockResolvedValueOnce(undefined);
  expect(await new VerifiedBackend('/trusted/root', 'darwin', 'arm64').defaultId()).toBeUndefined();
  mocks.resolve.mockResolvedValueOnce('/trusted/root/dist/audio-native/audio-darwin-arm64');
  expect(await new VerifiedBackend('/trusted/root', 'darwin', 'arm64').defaultId()).toBe('a');
});

it('derives the helper backend identity from the trusted local platform', async () => {
  mocks.identities.length = 0;
  mocks.resolve.mockResolvedValue('/trusted/root/dist/audio-native/helper');
  const mac = new VerifiedBackend('/trusted/root', 'darwin', 'arm64');
  const windows = new VerifiedBackend('/trusted/root', 'win32', 'x64');
  expect((await mac.capabilities()).backend).toBe('coreaudio');
  expect((await windows.capabilities()).backend).toBe('wasapi');
  expect(mocks.identities).toEqual(['coreaudio', 'wasapi']);
});
