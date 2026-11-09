import { describe, expect, it } from 'vitest';
import { decodeGpuResponse, encodeGpuResponse } from '../src/speech_gpu_ipc';
import { LOCAL_MAX_WAV_BYTES, LOCAL_PROTOCOL_VERSION } from '../src/speech_local_protocol';

describe('GPU IPC wire format', () => {
  const result = {
    type: 'result' as const,
    version: LOCAL_PROTOCOL_VERSION as typeof LOCAL_PROTOCOL_VERSION,
    epoch: 1,
    id: 1,
    part: 0,
    wav: Uint8Array.from({ length: 44 }, (_, index) => index),
    durationMs: 1,
  };
  it('round trips WAV bytes through JSON without runtime-specific serialization', () => {
    // Exercise the actual JSON wire format.
    // oxlint-disable-next-line unicorn/prefer-structured-clone
    const wire = JSON.parse(JSON.stringify(encodeGpuResponse(result))) as unknown;
    expect(decodeGpuResponse(wire)).toEqual(result);
  });
  it('rejects malformed and oversized byte strings', () => {
    const wire = encodeGpuResponse(result);
    expect(decodeGpuResponse({ ...wire, wav: '!!!!' })).toBeUndefined();
    expect(decodeGpuResponse({ ...wire, wav: 'AB==' })).toBeUndefined();
    expect(decodeGpuResponse({ ...wire, wav: 1 })).toBeUndefined();
    expect(decodeGpuResponse({ type: 'result' })).toBeUndefined();
    expect(decodeGpuResponse('invalid')).toBeUndefined();
    expect(decodeGpuResponse({})).toBeUndefined();
    const maximum = new Uint8Array(LOCAL_MAX_WAV_BYTES);
    const decoded = decodeGpuResponse(encodeGpuResponse({ ...result, wav: maximum }));
    expect(decoded?.type).toBe('result');
    if (decoded?.type === 'result') expect(Buffer.from(decoded.wav).equals(Buffer.from(maximum))).toBe(true);
    expect(decodeGpuResponse({ ...wire, wav: Buffer.alloc(LOCAL_MAX_WAV_BYTES + 1).toString('base64') })).toBeUndefined();
    expect(decodeGpuResponse({ ...wire, wav: 'A'.repeat(4 * Math.ceil(LOCAL_MAX_WAV_BYTES / 3) + 1) })).toBeUndefined();
    expect(decodeGpuResponse({ ...wire, unexpected: true })).toBeUndefined();
    expect(decodeGpuResponse({ ...wire, wav: 'AA==' })).toBeUndefined();
  });
  it('validates non-audio messages and rejects invalid inputs', () => {
    const failure = {
      type: 'failure' as const,
      version: LOCAL_PROTOCOL_VERSION as typeof LOCAL_PROTOCOL_VERSION,
      category: 'load' as const,
    };
    expect(decodeGpuResponse(encodeGpuResponse(failure))).toEqual(failure);
    // JSON IPC can supply null.
    // oxlint-disable-next-line unicorn/no-null
    expect(decodeGpuResponse(null)).toBeUndefined();
    expect(() => encodeGpuResponse({ ...result, wav: new Uint8Array(1) })).toThrow();
  });
});
