import { expect, it } from 'vitest';
import { helperFilename } from '../src/helper_location';

it('chooses only the four supported bundled helper names', () => {
  expect(helperFilename('darwin', 'arm64')).toBe('audio-darwin-arm64');
  expect(helperFilename('darwin', 'x64')).toBe('audio-darwin-x64');
  expect(helperFilename('win32', 'arm64')).toBe('audio-win32-arm64.exe');
  expect(helperFilename('win32', 'x64')).toBe('audio-win32-x64.exe');
});

it('rejects unsupported and path-like platform and architecture values', () => {
  const invalid: Array<[string, string]> = [
    ['linux', 'x64'],
    ['darwin', 'ia32'],
    ['../bin', 'x64'],
    ['win32', '../arm64'],
  ];
  for (const [platform, arch] of invalid) {
    expect(helperFilename(platform, arch)).toBeUndefined();
  }
});
