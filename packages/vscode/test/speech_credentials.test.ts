import { describe, expect, it, vi } from 'vitest';
import { SpeechCredentials } from '../src/speech_credentials';

describe('speech credentials', () => {
  it('PromptSafe: stores only a prompted key and preserves it when a prompt is canceled', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue('old'),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const prompt = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('new-key');
    const changed = vi.fn<() => void>();
    const credentials = new SpeechCredentials(storage, prompt, changed);
    await credentials.set();
    expect(storage.store).not.toHaveBeenCalled();
    await credentials.set();
    expect(storage.store).toHaveBeenCalledWith('aiPair.elevenLabs.apiKey', 'new-key');
    expect(changed).toHaveBeenCalledOnce();
    expect(await credentials.hasKey()).toBe(true);
    await credentials.remove();
    expect(storage.delete).toHaveBeenCalledWith('aiPair.elevenLabs.apiKey');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('does not store an old prompt after removal, and reports storage failures', async () => {
    const pending = Promise.withResolvers<string | undefined>();
    const storage = {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockRejectedValue(new Error('storage')),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const prompt = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce('new-key');
    const credentials = new SpeechCredentials(storage, prompt, vi.fn<() => void>());
    const first = credentials.set();
    await credentials.remove();
    pending.resolve('stale');
    await first;
    expect(storage.store).not.toHaveBeenCalled();
    await expect(credentials.set()).rejects.toThrow('storage');
  });
});

it('invalidates cloud work immediately and waits for an in-flight removal before reading', async () => {
  const pending = Promise.withResolvers<void>();
  let value: string | undefined = 'old-key';
  const storage = {
    get: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(value)),
    store: vi.fn(() => Promise.resolve()),
    delete: vi.fn(async () => {
      await pending.promise;
      value = undefined;
    }),
  };
  const changed = vi.fn<() => void>();
  const credentials = new SpeechCredentials(storage, vi.fn<() => Promise<string | undefined>>(), changed);
  const removal = credentials.remove();
  expect(changed).toHaveBeenCalledOnce();
  const read = credentials.read();
  pending.resolve();
  await removal;
  expect(await read).toBeUndefined();
});

it('ReadSafe: waits for replacement and rejects a stale read after an external change', async () => {
  const write = Promise.withResolvers<void>();
  let value = 'old';
  const storage = {
    get: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(value)),
    store: vi.fn(async (storageKey: string, key: string) => {
      await write.promise;
      if (storageKey) value = key;
    }),
    delete: vi.fn(() => Promise.resolve()),
  };
  const changed = vi.fn<() => void>();
  const credentials = new SpeechCredentials(storage, vi.fn().mockResolvedValue('new'), changed);
  const set = credentials.set();
  await Promise.resolve();
  expect(changed).toHaveBeenCalledOnce();
  const reading = credentials.read();
  write.resolve();
  await set;
  expect(await reading).toBe('new');
  const delayed = Promise.withResolvers<string | undefined>();
  storage.get.mockReturnValueOnce(delayed.promise);
  const stale = credentials.read();
  await Promise.resolve();
  credentials.invalidate();
  delayed.resolve('old');
  expect(await stale).toBeUndefined();
});

it('ignores a pending password prompt when the provider changes', async () => {
  const pending = Promise.withResolvers<string | undefined>();
  const storage = {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const credentials = new SpeechCredentials(
    storage,
    vi.fn<() => Promise<string | undefined>>().mockReturnValue(pending.promise),
    vi.fn<() => void>(),
  );
  const set = credentials.set();
  credentials.supersede();
  pending.resolve('stale');
  await set;
  expect(storage.store).not.toHaveBeenCalled();
});
