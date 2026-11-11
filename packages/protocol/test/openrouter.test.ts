import { expect, it } from 'vitest';
import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '../src/openrouter';

const model = 'microsoft/mai-voice-2.1';
const voice = 'en-US-Harper:MAI-Voice-2.1';
it('accepts bounded catalog metadata and ignores provider additions', () => {
  expect(openRouterCatalog.parse({ data: [{ id: model, extra: 'ignored' }] })).toEqual({ data: [{ id: model, extra: 'ignored' }] });
  expect(openRouterSpeechModel.parse({ id: model, name: 'MAI', supported_voices: [voice], extra: 'ignored' })).toEqual({
    id: model,
    name: 'MAI',
    supported_voices: [voice],
  });
});
it('rejects malformed or oversized catalog data', () => {
  for (const value of [{}, { data: [{}] }, { data: Array.from({ length: 501 }, () => ({ id: model })) }, { data: [{ id: '' }] }]) {
    expect(openRouterCatalog.safeParse(value).success).toBe(false);
  }
  for (const value of [
    { id: model, name: '', supported_voices: [] },
    { id: model, name: 'x', supported_voices: ['!'] },
    { id: model, name: 'x', supported_voices: Array.from({ length: 501 }, () => voice) },
  ]) {
    expect(openRouterSpeechModel.safeParse(value).success).toBe(false);
  }
});
it('accepts only bounded PCM requests with optional ZDR enforcement', () => {
  const request = { model, voice, input: 'Hello', response_format: 'pcm' };
  expect(openRouterSpeechRequest.safeParse(request).success).toBe(true);
  expect(openRouterSpeechRequest.safeParse({ ...request, provider: { zdr: true } }).success).toBe(true);
  for (const value of [
    { ...request, provider: { zdr: false } },
    { ...request, input: '' },
    { ...request, input: 'x'.repeat(10_001) },
    { ...request, model: 'unknown' },
    { ...request, response_format: 'mp3' },
    { ...request, key: 'secret' },
  ]) {
    expect(openRouterSpeechRequest.safeParse(value).success).toBe(false);
  }
});
