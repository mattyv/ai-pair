import { describe, expect, it } from 'vitest';
import { extensionVersion, localAudioStatus } from '../src/local_audio_status';

describe('local audio status (#115)', () => {
  it('accepts a connected companion with its version, and a failure with its reason', () => {
    expect(localAudioStatus.safeParse({ state: 'connected', version: '0.47.0', build: 'abc' }).success).toBe(true);
    expect(localAudioStatus.safeParse({ state: 'failed', reason: 'not_found' }).success).toBe(true);
  });

  it('rejects an unknown reason, extra fields, and a version that is not one', () => {
    expect(localAudioStatus.safeParse({ state: 'failed', reason: 'unplugged' }).success).toBe(false);
    expect(localAudioStatus.safeParse({ state: 'connected', version: '0.47.0', build: 'abc', path: '/home' }).success).toBe(false);
    expect(localAudioStatus.safeParse({ state: 'connected', version: '0.47.0' }).success).toBe(false);
    expect(extensionVersion.safeParse('0.47.0 /home/user').success).toBe(false);
    expect(extensionVersion.safeParse('').success).toBe(false);
  });
});
