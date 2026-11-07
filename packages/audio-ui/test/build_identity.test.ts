import { describe, expect, it } from 'vitest';
import { companionBuildIdentity } from '../scripts/build_identity.mjs';

describe('companion build identity', () => {
  it('is deterministic, includes names and content, and changes with native assets', () => {
    const files = [
      { name: 'extension', content: 'code' },
      { name: 'dist/audio-native/manifest.json', content: 'hash-one' },
    ];
    const first = companionBuildIdentity(files);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
    expect(companionBuildIdentity(files)).toBe(first);
    expect(
      companionBuildIdentity([
        { name: 'extension', content: 'code' },
        { name: 'dist/audio-native/manifest.json', content: 'hash-two' },
      ]),
    ).not.toBe(first);
    expect(
      companionBuildIdentity([
        { name: 'different', content: 'code' },
        { name: 'dist/audio-native/manifest.json', content: 'hash-one' },
      ]),
    ).not.toBe(first);
  });
});
