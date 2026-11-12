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
const cpu = { phase: 'ready', requestedMode: 'cpu', actualBackend: 'cpu', gpuCheck: { phase: 'idle' } } as const;

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

it('shows local worker startup until the lifecycle reports ready', () => {
  expect(voiceIndicator(ready, { ...cpu, phase: 'loading' }, true, true)).toBe('starting');
  expect(voiceIndicator(ready, { ...cpu, phase: 'ready' }, true, true)).toBe('ready');
  expect(voiceIndicator(ready, { ...cpu, phase: 'checking' }, true, true)).toBe('checking');
  expect(voiceIndicator({ ...ready, provider: 'elevenlabs', keyConfigured: true }, { ...cpu, phase: 'loading' }, true, true)).toBe('ready');
});

it('reports lifecycle failures and refuses readiness before a worker starts', () => {
  expect(voiceIndicator(ready, { ...cpu, phase: 'failed' }, true, true)).toBe('unavailable');
  expect(voiceIndicator(ready, { ...cpu, phase: 'cold', failureReason: 'timeout' }, true, true)).toBe('unavailable');
  expect(voiceIndicator(ready, { ...cpu, phase: 'cold' }, true, true)).toBe('checking');
  expect(voiceIndicator(ready, { ...cpu, actualBackend: 'none' }, true, true)).toBe('checking');
});

it('shows current startup over an earlier playback failure, then preserves the failure', () => {
  const failed = { ...ready, lastPlayback: 'failed' } as const;
  expect(voiceIndicator(failed, { ...cpu, phase: 'loading' }, true, true)).toBe('starting');
  expect(voiceIndicator(failed, cpu, true, true)).toBe('unavailable');
  expect(voiceIndicator(failed, { ...cpu, phase: 'loading' }, false, true)).toBe('unavailable');
});

it('uses current OpenRouter key evidence without requiring a local runtime', () => {
  expect(voiceIndicator({ ...ready, provider: 'openrouter', keyConfigured: true, runtimeReady: false }, undefined, true, true)).toBe(
    'ready',
  );
  expect(voiceIndicator({ ...ready, provider: 'openrouter', keyConfigured: 'unknown' }, undefined, true, true)).toBe('checking');
  expect(voiceIndicator({ ...ready, provider: 'openrouter', keyConfigured: false }, undefined, true, true)).toBe('unavailable');
});
