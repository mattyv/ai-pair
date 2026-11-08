import { expect, it, vi } from 'vitest';
import { createLocalAudioAdapter } from '../src/factory';

const state = vi.hoisted(() => ({ used: [] as string[] }));
vi.mock('../src/linux_backend', () => ({
  LinuxBackend: class {
    kind = 'linux';
  },
}));
vi.mock('../src/verified_backend', () => ({
  VerifiedBackend: class {
    kind = 'verified';
  },
}));
vi.mock('../src/native_adapter', () => ({
  NativeAdapter: class {
    kind = 'adapter';
    constructor(backend: { kind: string }) {
      state.used.push(backend.kind);
    }
  },
}));

it('uses Linux only on the local Linux host with an absolute companion root', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor) throw new Error('Missing platform descriptor');
  try {
    state.used.length = 0;
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' });
    createLocalAudioAdapter('/trusted/root');
    createLocalAudioAdapter('relative');
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'darwin' });
    createLocalAudioAdapter('/trusted/root');
    expect(state.used).toEqual(['linux', 'verified', 'verified']);
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});
