import { expect, it, vi } from 'vitest';
import { createLocalAudioAdapter } from '../src/factory';

vi.mock('../src/linux_backend', () => ({
  LinuxBackend: class {
    list() {
      return Promise.resolve([]);
    }
    capabilities() {
      return Promise.resolve({ backend: 'test', location: 'ui', defaultOutput: false, deviceSelection: false, pauseResume: false });
    }
  },
}));

it('provides the local adapter boundary without consulting the workspace or a bridge path', async () => {
  const adapter = createLocalAudioAdapter('/trusted/companion/root');
  expect(adapter).toHaveProperty('admit');
  expect(adapter).toHaveProperty('stop');
  expect((await adapter.capabilities()).location).toBe('ui');
});

it('fails closed for an untrusted relative root or an unsupported local platform', async () => {
  expect(await createLocalAudioAdapter('relative/path').capabilities()).toMatchObject({ defaultOutput: false, deviceSelection: false });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor) throw new Error('Platform descriptor unavailable');
  try {
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'freebsd' });
    const adapter = createLocalAudioAdapter('/trusted/root');
    expect(await adapter.list()).toEqual([]);
    expect(await adapter.capabilities()).toMatchObject({ defaultOutput: false, deviceSelection: false });
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});

it('selects verified packaged helpers for macOS and Windows', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor) throw new Error('Platform descriptor unavailable');
  try {
    for (const platform of ['darwin', 'win32']) {
      Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
      expect(await createLocalAudioAdapter('/nonexistent/trusted/root').capabilities()).toMatchObject({
        defaultOutput: false,
        deviceSelection: false,
      });
    }
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});
