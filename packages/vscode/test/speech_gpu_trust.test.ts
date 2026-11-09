import { describe, expect, it, vi } from 'vitest';
import { trustedSystemPath, type SystemPathAccess } from '../src/speech_gpu_trust';

function access(): SystemPathAccess {
  return {
    readlink: vi.fn().mockRejectedValue(new Error('unexpected link')),
    lstat: vi.fn().mockResolvedValue({ uid: 0, mode: 0o755, symlink: false }),
  };
}

describe('GPU system file trust', () => {
  it('accepts root-owned paths with no writable ancestor', async () => {
    const fs = access();
    expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(true);
    expect(fs.lstat).toHaveBeenCalledWith('/');
    expect(fs.lstat).toHaveBeenCalledWith('/usr');
  });
  it('rejects relative, writable, unowned and unreadable paths', async () => {
    expect(await trustedSystemPath('example.so', access())).toBe(false);
    for (const stat of [
      { uid: 1000, mode: 0o755, symlink: false },
      { uid: 0, mode: 0o775, symlink: false },
    ]) {
      const fs = access();
      vi.mocked(fs.lstat).mockResolvedValueOnce(stat);
      expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(false);
    }
    const fs = access();
    vi.mocked(fs.lstat).mockRejectedValue(new Error('private'));
    expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(false);
  });
  it('walks absolute and relative root-owned symlinks and their target components', async () => {
    const fs = access();
    vi.mocked(fs.lstat).mockImplementation((name) =>
      Promise.resolve({ uid: 0, mode: 0o755, symlink: name === '/usr/lib/link' || name === '/opt/link' }),
    );
    vi.mocked(fs.readlink).mockImplementation((name) => Promise.resolve(name === '/usr/lib/link' ? '/opt/link' : '../usr/lib/target'));
    expect(await trustedSystemPath('/usr/lib/link', fs)).toBe(true);
    expect(fs.lstat).toHaveBeenCalledWith('/opt/link');
    expect(fs.lstat).toHaveBeenCalledWith('/usr/lib/target');
  });
  it('TrustedSymlinkChain: rejects a user-owned intermediate symlink even when the final target is trusted', async () => {
    const fs = access();
    vi.mocked(fs.readlink).mockImplementation((name) => Promise.resolve(name === '/usr/lib/link' ? '/tmp/user/hop' : '/usr/lib/target'));
    vi.mocked(fs.lstat).mockImplementation((name) =>
      Promise.resolve({
        uid: name === '/tmp/user/hop' ? 1000 : 0,
        mode: 0o755,
        symlink: name === '/usr/lib/link' || name === '/tmp/user/hop',
      }),
    );
    expect(await trustedSystemPath('/usr/lib/link', fs)).toBe(false);
    expect(fs.lstat).toHaveBeenCalledWith('/tmp/user/hop');
  });
  it('rejects loops and empty symlink targets', async () => {
    const loop = access();
    vi.mocked(loop.lstat).mockImplementation((name) => Promise.resolve({ uid: 0, mode: 0o755, symlink: name === '/link' }));
    vi.mocked(loop.readlink).mockResolvedValue('/link');
    expect(await trustedSystemPath('/link', loop)).toBe(false);
    vi.mocked(loop.readlink).mockResolvedValue('');
    expect(await trustedSystemPath('/link', loop)).toBe(false);
  });
});
