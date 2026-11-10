import { describe, expect, it } from 'vitest';
import { AUDIO_DIAGNOSTICS_SCHEMA } from '@ai-pair/protocol';
import { voiceIndicator } from '../src/voice_indicator';

const ready = AUDIO_DIAGNOSTICS_SCHEMA.parse({
  enabled: true,
  provider: 'kokoro',
  keyConfigured: 'unknown',
  voiceConfigured: true,
  output: 'default',
  routeAvailable: true,
  runtimeReady: true,
  modelReady: true,
  lastPlayback: 'unknown',
});
const cpu = { requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } as const;

describe('voice indicator', () => {
  it('reports off when speech is disabled', () => {
    expect(voiceIndicator({ ...ready, enabled: false }, cpu, true, true)).toBe('off');
  });
  it('requires known provider, route and GPU evidence before ready', () => {
    expect(voiceIndicator(undefined, cpu, true, true)).toBe('checking');
    expect(voiceIndicator(ready, cpu, false, true)).toBe('unavailable');
    expect(voiceIndicator({ ...ready, routeAvailable: 'unknown' }, cpu, true, true)).toBe('checking');
    expect(voiceIndicator({ ...ready, routeAvailable: false }, cpu, true, true)).toBe('unavailable');
    expect(voiceIndicator(ready, cpu, true, true)).toBe('ready');
    expect(voiceIndicator(ready, { ...cpu, requestedMode: 'gpu' }, true, true)).toBe('checking');
    expect(voiceIndicator(ready, { ...cpu, requestedMode: 'gpu', gpuCheck: { phase: 'ready' } }, true, true)).toBe('ready');
    expect(voiceIndicator(ready, { ...cpu, requestedMode: 'gpu', actualBackend: 'gpu' }, true, true)).toBe('ready');
    expect(voiceIndicator({ ...ready, provider: 'elevenlabs', keyConfigured: false }, cpu, true, true)).toBe('unavailable');
    expect(voiceIndicator({ ...ready, provider: 'elevenlabs', keyConfigured: true }, cpu, true, true)).toBe('ready');
    expect(voiceIndicator({ ...ready, lastPlayback: 'failed' }, cpu, true, true)).toBe('unavailable');
  });
});

it('distinguishes incomplete facts, provider failures and CPU fallback', () => {
  expect(voiceIndicator({ ...ready, voiceConfigured: false }, cpu, true, true)).toBe('unavailable');
  expect(voiceIndicator({ ...ready, runtimeReady: false }, cpu, true, true)).toBe('unavailable');
  expect(voiceIndicator({ ...ready, modelReady: false }, cpu, true, true)).toBe('unavailable');
  expect(voiceIndicator({ ...ready, runtimeReady: 'unknown' }, cpu, true, true)).toBe('checking');
  expect(voiceIndicator({ ...ready, modelReady: 'unknown' }, cpu, true, true)).toBe('checking');
  expect(voiceIndicator(ready, undefined, true, true)).toBe('checking');
  expect(voiceIndicator({ ...ready, provider: 'elevenlabs', keyConfigured: 'unknown' }, cpu, true, true)).toBe('checking');
  expect(voiceIndicator(ready, { ...cpu, requestedMode: 'gpu', gpuCheck: { phase: 'checking' } }, true, true)).toBe('checking');
  expect(voiceIndicator(ready, { ...cpu, requestedMode: 'gpu', gpuCheck: { phase: 'unavailable', reason: 'timeout' } }, true, true)).toBe(
    'unavailable',
  );
  expect(voiceIndicator(ready, { ...cpu, requestedMode: 'auto', gpuCheck: { phase: 'unavailable', reason: 'timeout' } }, true, true)).toBe(
    'ready',
  );
});

it('does not claim readiness without valid provider settings', () => {
  expect(voiceIndicator(ready, cpu, true, undefined)).toBe('checking');
  expect(voiceIndicator(ready, cpu, true, false)).toBe('unavailable');
});
