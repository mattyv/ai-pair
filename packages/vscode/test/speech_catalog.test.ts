import { expect, it, vi } from 'vitest';
import { SpeechCatalog, type CatalogView } from '../src/speech_catalog';

it('CatalogSafe, AcceptedSafe, RequestProgress, ReplyProgress: loads only on request and ignores stale results', async () => {
  const pending = Promise.withResolvers<{ voices: Array<{ id: string; name: string }>; nextCursor?: string }>();
  const voices = vi
    .fn()
    .mockResolvedValueOnce({ voices: [{ id: 'a', name: 'A' }], nextCursor: 'next' })
    .mockReturnValueOnce(pending.promise);
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices }, publish);
  expect(voices).not.toHaveBeenCalled();
  await catalog.load(false);
  expect(publish.mock.lastCall?.[0]).toMatchObject({ voices: [{ id: 'a', name: 'A' }], more: true });
  const later = catalog.load(true);
  catalog.invalidate();
  pending.resolve({ voices: [{ id: 'b', name: 'B' }] });
  await later;
  expect(publish.mock.lastCall?.[0]).toMatchObject({ voices: [], more: false });
});

it('reports sanitized catalog failure without exposing the error', async () => {
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices: vi.fn().mockRejectedValue(new Error('secret')) }, publish);
  await catalog.load(false);
  expect(JSON.stringify(publish.mock.calls)).not.toContain('secret');
  expect(publish.mock.lastCall?.[0]).toMatchObject({ error: true });
});

it('AcceptedSafe: a late old page cannot replace a newer voice list', async () => {
  const old = Promise.withResolvers<{ voices: Array<{ id: string; name: string }> }>();
  const voices = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ voices: [{ id: 'new', name: 'New' }] });
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices }, publish);
  const first = catalog.load(false);
  await catalog.load(false);
  old.resolve({ voices: [{ id: 'old', name: 'Old' }] });
  await first;
  expect(publish.mock.lastCall?.[0]).toMatchObject({ voices: [{ id: 'new', name: 'New' }] });
  expect(catalog.contains('old')).toBe(false);
  expect(catalog.contains('new')).toBe(true);
});

it('bounds results and stops repeated pagination cursors', async () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({ id: String(index), name: String(index) }));
  const voices = vi.fn().mockResolvedValueOnce({ voices: entries, nextCursor: 'more' });
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices }, publish);
  await catalog.load(false);
  expect(publish.mock.lastCall?.[0]).toMatchObject({ more: false });
  await catalog.load(true);
  expect(voices).toHaveBeenCalledOnce();
});

it('ignores an aborted request that rejects after its catalog was invalidated', async () => {
  const old = Promise.withResolvers<{ voices: Array<{ id: string; name: string }> }>();
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices: vi.fn().mockReturnValue(old.promise) }, publish);
  const request = catalog.load(false);
  catalog.invalidate();
  old.reject(new Error('aborted'));
  await request;
  expect(publish.mock.lastCall?.[0]).toEqual({ voices: [], more: false, loading: false, error: false, reset: true });
});

it('retains only an allowlisted failure category for diagnostics and display', async () => {
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices: vi.fn().mockRejectedValue({ kind: 'auth', key: 'do-not-copy' }) }, publish);
  await catalog.load(false);
  expect(publish.mock.lastCall?.[0]).toMatchObject({ error: true, errorKind: 'auth' });
  expect(JSON.stringify(publish.mock.calls)).not.toContain('do-not-copy');
});

it('maps missing-key and unknown errors to fixed safe categories', async () => {
  for (const [error, expected] of [
    [{ kind: 'key' }, 'no_key'],
    [new Error('private detail'), 'unknown'],
  ] as const) {
    const publish = vi.fn<(view: CatalogView) => void>();
    const catalog = new SpeechCatalog({ voices: vi.fn().mockRejectedValue(error) }, publish);
    await catalog.load(false);
    expect(publish.mock.lastCall?.[0]).toMatchObject({ error: true, errorKind: expected });
    expect(JSON.stringify(publish.mock.calls)).not.toContain('private detail');
  }
});

it('marks invalidation as a reset rather than a successful empty result', () => {
  const publish = vi.fn<(view: CatalogView) => void>();
  const catalog = new SpeechCatalog({ voices: vi.fn() }, publish);
  catalog.invalidate();
  expect(publish.mock.lastCall?.[0]).toMatchObject({ reset: true, voices: [], loading: false, error: false });
});
