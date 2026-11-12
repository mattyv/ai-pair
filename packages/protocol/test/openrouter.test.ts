import { expect, it } from 'vitest';
import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '../src/openrouter';

const model = 'microsoft/mai-voice-2.1';
const voice = 'en-US-Harper:MAI-Voice-2.1';
const newModel = 'mistralai/voxtral-mini-tts-2603';
it('accepts bounded catalog metadata and ignores provider additions', () => {
  expect(openRouterCatalog.parse({ data: [{ id: model, extra: 'ignored' }] })).toEqual({ data: [{ id: model, extra: 'ignored' }] });
  expect(openRouterSpeechModel.parse({ id: model, name: 'MAI', supported_voices: [voice], extra: 'ignored' })).toEqual({
    id: model,
    name: 'MAI',
    supported_voices: [voice],
  });
});
it('accepts a bounded model and advertised voice without an allowlist', () => {
  const entry = { id: newModel, name: 'New speech', supported_voices: ['voice/42 + natural'] };
  expect(openRouterSpeechModel.parse(entry)).toEqual(entry);
  expect(
    openRouterSpeechRequest.safeParse({ model: newModel, voice: 'voice/42 + natural', input: 'Hi', response_format: 'pcm' }).success,
  ).toBe(true);
});
it('rejects malformed or oversized catalog data', () => {
  for (const value of [{}, { data: [{}] }, { data: Array.from({ length: 501 }, () => ({ id: model })) }, { data: [{ id: '' }] }]) {
    expect(openRouterCatalog.safeParse(value).success).toBe(false);
  }
  for (const value of [
    { id: model, name: '', supported_voices: [] },
    { id: model, name: 'x', supported_voices: ['bad\nvoice'] },
    { id: model, name: 'x', supported_voices: Array.from({ length: 501 }, () => voice) },
  ]) {
    expect(openRouterSpeechModel.safeParse(value).success).toBe(false);
  }
  // eslint-disable-next-line unicorn/no-null -- OpenRouter returns null when a model has no voice list.
  expect(openRouterSpeechModel.safeParse({ id: model, name: 'No voice list', supported_voices: null }).success).toBe(true);
});
it('accepts bounded PCM requests with optional ZDR enforcement', () => {
  const request = { model, voice, input: 'Hello', response_format: 'pcm' };
  expect(openRouterSpeechRequest.safeParse(request).success).toBe(true);
  expect(openRouterSpeechRequest.safeParse({ ...request, provider: { zdr: true } }).success).toBe(true);
  expect(openRouterSpeechRequest.safeParse({ ...request, response_format: 'mp3' }).success).toBe(true);
  for (const value of [
    { ...request, provider: { zdr: false } },
    { ...request, input: '' },
    { ...request, input: 'x'.repeat(10_001) },
    { ...request, model: '' },
    { ...request, model: 'x'.repeat(257) },
    { ...request, model: 'bad\nmodel' },
    { ...request, voice: 'bad\nvoice' },
    { ...request, voice: 'v'.repeat(161) },
    { ...request, response_format: 'wav' },
    { ...request, key: 'secret' },
  ]) {
    expect(openRouterSpeechRequest.safeParse(value).success).toBe(false);
  }
});
