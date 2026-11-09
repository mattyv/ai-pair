import { describe, expect, it, vi } from 'vitest';
import { trustedSystemPath, type SystemPathAccess } from '../src/speech_gpu_trust';

function access(): SystemPathAccess {
  return { realpath: vi.fn().mockImplementation((value: string) => Promise.resolve(value)), lstat: vi.fn().mockResolvedValue({ uid: 0, mode: 0o755, symlink: false }) };
}

describe('GPU system file trust', () => {
  it('accepts root-owned paths with no writable ancestor', async () => {
    const fs = access();
    expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(true);
    expect(fs.lstat).toHaveBeenCalledWith('/usr');
    expect(fs.lstat).toHaveBeenCalledWith('/usr/lib/example.so');
  });
  it('rejects relative paths, writable or unowned ancestors, and errors', async () => {
    expect(await trustedSystemPath('example.so', access())).toBe(false);
    for (const stat of [{ uid: 1000, mode: 0o755, symlink: false }, { uid: 0, mode: 0o775, symlink: false }]) {
      const fs = access();
      vi.mocked(fs.lstat).mockResolvedValueOnce(stat);
      expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(false);
    }
    const fs = access();
    vi.mocked(fs.realpath).mockRejectedValue(new Error('private'));
    expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(false);
  });
  it('checks both the original and resolved paths, including root-owned symlinks', async () => {
    const fs = access();
    vi.mocked(fs.realpath).mockResolvedValue('/opt/lib/example.so');
    vi.mocked(fs.lstat).mockImplementation((value) => Promise.resolve({ uid: 0, mode: value === '/usr/lib/example.so' ? 0o777 : 0o755, symlink: value === '/usr/lib/example.so' }));
    expect(await trustedSystemPath('/usr/lib/example.so', fs)).toBe(true);
    expect(fs.lstat).toHaveBeenCalledWith('/opt/lib/example.so');
  });
});
