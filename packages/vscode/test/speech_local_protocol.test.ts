import { describe, expect, it } from 'vitest';
import {
  LOCAL_CAPABILITIES,
  LOCAL_MAX_DURATION_MS,
  LOCAL_MAX_WAV_BYTES,
  LOCAL_MIN_WAV_BYTES,
  LOCAL_PROTOCOL_VERSION,
  LOCAL_REQUEST,
  LOCAL_RESPONSE,
  localWorkerError,
} from '../src/speech_local_protocol';

const version = LOCAL_PROTOCOL_VERSION;
const synthesize = { type: 'synthesize', version, epoch: 1, id: 1, part: 0, final: true, text: 'Hello.', voice: 'af_heart', speed: 1 };
const capabilities = {
  voices: [...LOCAL_CAPABILITIES.voices],
  speeds: [...LOCAL_CAPABILITIES.speeds],
  sampleRate: LOCAL_CAPABILITIES.sampleRate,
  sampleFormat: LOCAL_CAPABILITIES.sampleFormat,
  maxWavBytes: LOCAL_CAPABILITIES.maxWavBytes,
  maxDurationMs: LOCAL_CAPABILITIES.maxDurationMs,
  maxParts: LOCAL_CAPABILITIES.maxParts,
};
const result = { type: 'result', version, epoch: 1, id: 1, part: 0, wav: new Uint8Array(LOCAL_MIN_WAV_BYTES), durationMs: 1000 };

describe('local synthesis requests', () => {
  it('accepts the versioned init, synthesize and shutdown forms', () => {
    expect(LOCAL_REQUEST.safeParse({ type: 'init', version, epoch: 1, modelPath: '/model' }).success).toBe(true);
    expect(LOCAL_REQUEST.safeParse(synthesize).success).toBe(true);
    expect(LOCAL_REQUEST.safeParse({ type: 'shutdown', version }).success).toBe(true);
  });

  it('rejects other versions, extra fields and out-of-range values', () => {
    for (const value of [
      { type: 'init', version: 2, epoch: 1, modelPath: '/model' },
      { type: 'init', version, epoch: 0, modelPath: '/model' },
      { type: 'init', version, epoch: 1, modelPath: '' },
      { type: 'init', version, epoch: 1, modelPath: '/model', extra: true },
      { type: 'shutdown', version, epoch: 1 },
      { ...synthesize, part: 4 },
      { ...synthesize, part: -1 },
      { ...synthesize, id: 0 },
      { ...synthesize, final: undefined },
      { ...synthesize, text: '' },
      { ...synthesize, voice: 'other' },
      { ...synthesize, speed: 4 },
      { type: 'load', modelPath: '/model' },
    ]) {
      expect(LOCAL_REQUEST.safeParse(value).success).toBe(false);
    }
  });
});

describe('local synthesis responses', () => {
  it('accepts ready only with the exact capabilities of the host constants', () => {
    const ready = { type: 'ready', version, epoch: 1, capabilities };
    expect(LOCAL_RESPONSE.safeParse(ready).success).toBe(true);
    for (const changed of [
      { voices: ['af_heart'] },
      { voices: capabilities.voices.toReversed() },
      { speeds: [1] },
      { sampleRate: 16_000 },
      { sampleFormat: 'float32' },
      { maxWavBytes: LOCAL_MAX_WAV_BYTES + 1 },
      { maxDurationMs: LOCAL_MAX_DURATION_MS + 1 },
      { maxParts: 9 },
      { extra: 1 },
    ]) {
      expect(LOCAL_RESPONSE.safeParse({ ...ready, capabilities: { ...capabilities, ...changed } }).success).toBe(false);
    }
  });

  it('accepts a bounded result and rejects an oversized, undersized or malformed one before buffering', () => {
    expect(LOCAL_RESPONSE.safeParse(result).success).toBe(true);
    for (const changed of [
      { wav: new Uint8Array(LOCAL_MAX_WAV_BYTES + 1) },
      { wav: new Uint8Array(LOCAL_MIN_WAV_BYTES - 1) },
      { wav: 'bytes' },
      { durationMs: 0 },
      { durationMs: LOCAL_MAX_DURATION_MS + 1 },
      { durationMs: Number.NaN },
      { part: 4 },
      { epoch: undefined },
      { id: undefined },
    ]) {
      expect(LOCAL_RESPONSE.safeParse({ ...result, ...changed }).success).toBe(false);
    }
  });

  it('accepts only fixed failure categories, never free text', () => {
    for (const category of ['load', 'synthesis', 'protocol', 'busy']) {
      expect(LOCAL_RESPONSE.safeParse({ type: 'failure', version, category }).success).toBe(true);
    }
    expect(LOCAL_RESPONSE.safeParse({ type: 'failure', version, epoch: 1, id: 2, part: 1, category: 'synthesis' }).success).toBe(true);
    expect(LOCAL_RESPONSE.safeParse({ type: 'failure', version, category: 'secret path' }).success).toBe(false);
    expect(LOCAL_RESPONSE.safeParse({ type: 'failure', version, category: 'load', message: 'secret' }).success).toBe(false);
  });
});

describe('localWorkerError', () => {
  it('maps only Node error codes to fixed categories', () => {
    expect(localWorkerError({ code: 'ERR_MODULE_NOT_FOUND' })).toBe('worker_module');
    expect(localWorkerError({ code: 'MODULE_NOT_FOUND' })).toBe('worker_module');
    expect(localWorkerError({ code: 'ERR_DLOPEN_FAILED' })).toBe('worker_native');
    expect(localWorkerError({ code: 'EACCES' })).toBe('worker_permission');
    expect(localWorkerError({ code: 'EPERM' })).toBe('worker_permission');
    expect(localWorkerError({ code: 'EOTHER' })).toBe('worker_error');
    expect(localWorkerError(new Error('/secret/path'))).toBe('worker_error');
    expect(localWorkerError('text')).toBe('worker_error');
    expect(localWorkerError(JSON.parse('null'))).toBe('worker_error');
  });
});
