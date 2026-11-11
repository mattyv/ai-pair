import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSpeechPlatform, localSpeechPlatform, processMaps } from '../src/speech_platform';

const io = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('node:fs', () => ({ openSync: io.open, readSync: io.read, closeSync: io.close }));

const glibcMaps =
  '0-1 r-xp 0 00:00 0 /usr/lib/x86_64-linux-gnu/libc.so.6\n1-2 r-xp 0 00:00 0 /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2\n';
function check(report: () => unknown, maps: () => string, platform = 'linux', arch = 'x64') {
  return detectSpeechPlatform({ platform, arch, report, maps });
}
function fail(): never {
  throw new Error('unexpected probe');
}

describe('Kokoro platform evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('accepts a positive runtime report without reading maps', () => {
    expect(
      check(
        () => ({ header: { glibcVersionRuntime: '2.35' } }),
        () => {
          throw new Error('unexpected');
        },
      ),
    ).toEqual({ supported: true });
  });

  it('accepts verified process mappings when the report is missing or throws', () => {
    expect(
      check(
        () => undefined,
        () => glibcMaps,
      ),
    ).toEqual({ supported: true });
    expect(
      check(
        () => {
          throw new Error('report');
        },
        () => glibcMaps,
      ),
    ).toEqual({ supported: true });
  });

  it('fails closed on musl, incomplete, ambiguous or unreadable mappings', () => {
    expect(
      check(
        () => undefined,
        () => `${glibcMaps}2-3 r-xp 0 00:00 0 /lib/ld-musl-x86_64.so.1\n`,
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => undefined,
        () => '/lib/libc.so.6\n',
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => undefined,
        () => '',
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => {
          throw new Error('report');
        },
        () => {
          throw new Error('maps');
        },
      ).supported,
    ).toBe(false);
  });

  it('accepts Snap mappings but rejects deleted or malformed evidence', () => {
    const snap = glibcMaps.replaceAll('/usr/lib/', '/snap/code/276/usr/lib/');
    expect(
      check(
        () => ({ header: { glibcVersionRuntime: '' } }),
        () => snap,
      ),
    ).toEqual({ supported: true });
    expect(
      check(
        () => undefined,
        () => snap.replace('libc.so.6\n', 'libc.so.6 (deleted)\n'),
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => ({ header: undefined }),
        () => '',
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => ({ header: { glibcVersionRuntime: 1 } }),
        () => '',
      ).supported,
    ).toBe(false);
  });

  it('recognizes older GNU mapped filenames and ignores musl in directory names', () => {
    const older = glibcMaps.replace('libc.so.6', 'libc-2.31.so').replace('ld-linux-x86-64.so.2', 'ld-2.31.so');
    expect(
      check(
        () => undefined,
        () => older.replaceAll('/usr/', '/home/musl/usr/'),
      ),
    ).toEqual({ supported: true });
    expect(
      check(
        () => undefined,
        () => `${older}2-3 r-xp 0 00:00 0 /lib/ld-musl-x86_64.so.1\n`,
      ).supported,
    ).toBe(false);
  });

  it('rejects filenames that only resemble evidence inside malformed paths or records', () => {
    expect(
      check(
        () => undefined,
        () => glibcMaps.replaceAll('\n', ' suffix\n'),
      ).supported,
    ).toBe(false);
    expect(
      check(
        () => undefined,
        () => '/tmp/libc.so.6\n/tmp/ld-linux-x86-64.so.2\n',
      ).supported,
    ).toBe(false);
  });

  it('rejects another OS or architecture before probing', () => {
    expect(check(fail, fail, 'freebsd')).toEqual({ supported: false, reason: 'host_platform' });
    expect(check(fail, fail, 'linux', 'arm64')).toEqual({ supported: false, reason: 'host_arch' });
  });

  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
  ])('SpeechPlatformEvidence RecognizesEvidence: accepts %s %s without libc probes', (platform, arch) => {
    expect(check(fail, fail, platform, arch)).toEqual({ supported: true });
  });

  it('SpeechPlatformEvidence PositiveEvidence: rejects Windows, or macOS on another architecture, before probing', () => {
    expect(check(fail, fail, 'win32', 'x64')).toEqual({ supported: false, reason: 'host_platform' });
    expect(check(fail, fail, 'darwin', 'ppc64')).toEqual({ supported: false, reason: 'host_arch' });
  });

  it('reads bounded current-process maps and closes the descriptor', () => {
    io.open.mockReturnValue(7);
    io.read
      .mockImplementationOnce((fd: number, data: Buffer) => {
        expect(fd).toBe(7);
        return data.write('abc');
      })
      .mockReturnValueOnce(0);
    expect(processMaps()).toBe('abc');
    expect(io.open).toHaveBeenCalledWith('/proc/self/maps', 'r');
    expect(io.close).toHaveBeenCalledWith(7);
  });

  it('rejects oversized or unreadable mappings and closes an opened descriptor', () => {
    io.open.mockReturnValue(7);
    io.read.mockReturnValueOnce(1_048_577);
    expect(() => processMaps()).toThrow();
    expect(io.close).toHaveBeenCalledWith(7);
    io.read.mockImplementationOnce(() => {
      throw new Error('read');
    });
    expect(() => processMaps()).toThrow();
    expect(io.close).toHaveBeenCalledTimes(2);
  });

  it('uses current-process evidence in the local wrapper', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const arch = Object.getOwnPropertyDescriptor(process, 'arch');
    const sample = process.report.getReport();
    if (!('header' in sample) || typeof sample.header !== 'object' || sample.header === null) throw new Error('missing report header');
    Object.defineProperty(sample.header, 'glibcVersionRuntime', { value: '2.35', configurable: true });
    const report = vi.spyOn(process.report, 'getReport').mockReturnValue(sample);
    try {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      expect(localSpeechPlatform()).toEqual({ supported: true });
    } finally {
      report.mockRestore();
      if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
      if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
    }
  });
});
