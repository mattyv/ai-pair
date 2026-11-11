import { expect, it, vi } from 'vitest';
import { OpenRouterCatalog, type OpenRouterCatalogView } from '../src/speech_openrouter_catalog';
import type { OpenRouterSpeechPort } from '../src/speech_types';

it('CatalogStale: invalidation rejects late catalog replies', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; name: string; voices: Array<{ id: string; name: string }> }>>();
  const client = { models: vi.fn<OpenRouterSpeechPort['models']>().mockReturnValue(pending.promise) };
  const publish = vi.fn<(view: OpenRouterCatalogView) => void>();
  const catalog = new OpenRouterCatalog(client, publish);
  const loading = catalog.load(true);
  const signal = client.models.mock.calls[0]?.[1];
  catalog.invalidate();
  pending.resolve([{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }]);
  await loading;
  expect(signal?.aborted).toBe(true);
  expect(catalog.contains('model', 'voice')).toBe(false);
  expect(publish).toHaveBeenLastCalledWith({ state: 'idle', verified: false, models: [] });
});

it('publishes only current successful results and fails closed on error', async () => {
  const client = {
    models: vi
      .fn<OpenRouterSpeechPort['models']>()
      .mockResolvedValueOnce([{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }])
      .mockRejectedValueOnce(new Error('secret')),
  };
  const publish = vi.fn<(view: OpenRouterCatalogView) => void>();
  const catalog = new OpenRouterCatalog(client, publish);
  await catalog.load(false);
  expect(catalog.contains('model', 'voice')).toBe(true);
  await catalog.load(true);
  expect(catalog.contains('model', 'voice')).toBe(true);
  expect(publish).toHaveBeenLastCalledWith({
    state: 'error',
    verified: true,
    models: [{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }],
    message: 'Could not load OpenRouter models. Check your key and account access.',
  });
});

it('discards a superseded rejection and aborts an earlier request when reloading', async () => {
  const pending = Promise.withResolvers<never>();
  const client = { models: vi.fn<OpenRouterSpeechPort['models']>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]) };
  const publish = vi.fn<(view: OpenRouterCatalogView) => void>();
  const catalog = new OpenRouterCatalog(client, publish);
  const first = catalog.load(false);
  const signal = client.models.mock.calls[0]?.[1];
  await catalog.load(true);
  pending.reject(new Error('private'));
  await first;
  expect(signal?.aborted).toBe(true);
  expect(publish).toHaveBeenLastCalledWith({ state: 'ready', verified: true, models: [] });
});

it('CatalogEligibility: rejects a remembered pair only after an authoritative catalog excludes it', async () => {
  const client = { models: vi.fn<OpenRouterSpeechPort['models']>().mockResolvedValue([]) };
  const catalog = new OpenRouterCatalog(client, vi.fn<(view: OpenRouterCatalogView) => void>());
  expect(catalog.allows('model', 'voice')).toBe(true);
  await catalog.load(true);
  expect(catalog.allows('model', 'voice')).toBe(false);
  catalog.invalidate();
  expect(catalog.allows('model', 'voice')).toBe(true);
});

it('DeniedRefresh: keeps a denial while refreshing the same identity and after failure', async () => {
  const pending = Promise.withResolvers<never>();
  const client = { models: vi.fn<OpenRouterSpeechPort['models']>().mockResolvedValueOnce([]).mockReturnValueOnce(pending.promise) };
  const catalog = new OpenRouterCatalog(client, vi.fn<(view: OpenRouterCatalogView) => void>());
  await catalog.load(false);
  expect(catalog.allows('model', 'voice')).toBe(false);
  const refresh = catalog.load(false);
  expect(catalog.allows('model', 'voice')).toBe(false);
  pending.reject(new Error('private'));
  await refresh;
  expect(catalog.allows('model', 'voice')).toBe(false);
});

it('CatalogProgress: permits an unknown restored pair', () => {
  const client = { models: vi.fn<OpenRouterSpeechPort['models']>() };
  const catalog = new OpenRouterCatalog(client, vi.fn<(view: OpenRouterCatalogView) => void>());
  expect(catalog.allows('model', 'voice')).toBe(true);
});
