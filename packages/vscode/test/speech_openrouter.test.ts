import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '@ai-pair/protocol';
/* eslint-disable @typescript-eslint/require-await, unicorn/no-null -- Provider and Response mocks. */
import { afterEach, expect, it, vi } from 'vitest';
import { OpenRouterClient, OpenRouterError } from '../src/speech_openrouter';
import type { OpenRouterAudioDecodeLease, OpenRouterAudioDecoder } from '../src/speech_types';

const sharedLease = {
  signal: new AbortController().signal,
  decode: vi.fn<OpenRouterAudioDecodeLease['decode']>(async () => ({ wav: new Uint8Array([5]), durationMs: 601 })),
  cancel: vi.fn(),
};
const sharedDecoder = { admit: vi.fn<OpenRouterAudioDecoder['admit']>(async () => sharedLease) };
function rejectCancel(): Promise<void> {
  return Promise.reject(new Error('private'));
}
const model = 'microsoft/mai-voice-2.1';
const voice = 'en-US-Harper:MAI-Voice-2.1';
function signal(): AbortSignal {
  return new AbortController().signal;
}
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
const catalog = openRouterCatalog.parse({ data: [openRouterSpeechModel.parse({ id: model, name: 'MAI', supported_voices: [voice] })] });
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('AccountOnly uses the authenticated account catalog and maps advertised voices', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json(catalog));
  expect(await new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(false, signal())).toEqual([
    { id: model, name: 'MAI', voices: [{ id: voice, name: voice }] },
  ]);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/models/user?output_modalities=speech');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer secret' }, redirect: 'error' });
});
it('carries advertised model rates through the account catalog without excluding malformed pricing', async () => {
  const data = openRouterCatalog.parse({
    data: [
      { id: 'vendor/characters', name: 'Characters', supported_voices: [], pricing: { prompt: '0.000015', completion: '0' } },
      { id: 'vendor/seconds', name: 'Seconds', supported_voices: [], pricing: { completion: '0.0025' } },
      { id: 'vendor/unknown', name: 'Unknown', supported_voices: [], pricing: { prompt: '-1', completion: 'NaN' } },
      { id: 'vendor/missing', name: 'Missing', supported_voices: [] },
    ],
  });
  const fetcher = vi.fn<typeof fetch>(async () => json(data));
  const models = await new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(false, signal());
  expect(models).toHaveLength(4);
  expect(models[0]).toMatchObject({
    id: 'vendor/characters',
    pricing: { prompt: '0.000015', completion: '0' },
  });
  expect(models[1]).toMatchObject({ id: 'vendor/seconds', pricing: { completion: '0.0025' } });
  expect(models[2]).toMatchObject({ id: 'vendor/unknown', name: 'Unknown', voices: [] });
  expect(models[2]?.pricing?.prompt).toBeUndefined();
  expect(models[2]?.pricing?.completion).toBeUndefined();
  expect(models[3]).toMatchObject({ id: 'vendor/missing', name: 'Missing', voices: [] });
});
it('ZdrSelection intersects the authenticated catalog with the public ZDR catalog', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(catalog))
    .mockResolvedValueOnce(json({ data: [] }));
  expect(await new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(true, signal())).toEqual([]);
  expect(fetcher.mock.calls[1]?.[0]).toContain('zdr=true');
});
it('ZdrSelection reads model IDs even when the public catalog has no voice metadata', async () => {
  const account = { data: [{ id: 'vendor/new-speech-model', name: 'New', supported_voices: [voice] }] };
  const zdr = { data: [{ id: 'vendor/new-speech-model', name: 'New', supported_voices: null }] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(account)).mockResolvedValueOnce(json(zdr));
  expect(await new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(true, signal())).toEqual([
    { id: 'vendor/new-speech-model', name: 'New', voices: [{ id: voice, name: voice }] },
  ]);
});
it('rejects a malformed ZDR model-ID catalog', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(catalog))
    .mockResolvedValueOnce(json({ data: [{ id: 1 }] }));
  await expect(new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(true, signal())).rejects.toMatchObject({
    kind: 'invalid',
  });
});
it('AccountOnly never falls back when authentication fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('secret body', { status: 401 }));
  await expect(new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(true, signal())).rejects.toMatchObject({
    kind: 'auth',
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('PolicySampled sends the selected request and converts documented PCM', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  const result = await new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).synthesize(
    { id: 1, format: 'pcm' as const, text: 'private', modelId: model, voiceId: voice, zdr: true },
    signal(),
  );
  const request = fetcher.mock.calls[0]?.[1];
  expect(request?.redirect).toBe('error');
  if (typeof request?.body !== 'string') throw new Error('missing body');
  expect(openRouterSpeechRequest.parse(JSON.parse(request.body))).toEqual({
    model,
    voice,
    input: 'private',
    response_format: 'pcm',
    provider: { zdr: true },
  });
  expect(sharedLease.decode).toHaveBeenCalledWith(
    { format: 'pcm', bytes: new Uint8Array([1, 0]), sampleRate: 24_000, channels: 1 },
    expect.any(AbortSignal),
  );
  expect(result).toEqual({ wav: new Uint8Array([5]), durationMs: 601 });
});
it('rejects incompatible audio metadata and invalid models', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm; rate=7000; channels=1' } }),
  );
  const client = new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder);
  await expect(
    client.synthesize({ id: 1, format: 'pcm' as const, text: 'x', modelId: model, voiceId: voice, zdr: false }, signal()),
  ).rejects.toMatchObject({
    kind: 'invalid',
  });
  await expect(
    client.synthesize({ id: 1, format: 'pcm' as const, text: 'x', modelId: '', voiceId: voice, zdr: false }, signal()),
  ).rejects.toMatchObject({
    kind: 'invalid',
  });
});

it.each([
  [403, 'auth'],
  [404, 'auth'],
  [429, 'rate'],
  [500, 'network'],
] as const)('sanitizes HTTP %i as %s', async (status, kind) => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('secret body', { status }));
  await expect(new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).models(false, signal())).rejects.toMatchObject({ kind });
});
it('rejects absent credentials, rejected fetch and bad request arguments', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('secret');
  });
  await expect(new OpenRouterClient(async () => undefined, fetcher).models(false, signal())).rejects.toMatchObject({ kind: 'key' });
  await expect(new OpenRouterClient(async () => '', fetcher).models(false, signal())).rejects.toMatchObject({ kind: 'key' });
  const client = new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder);
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'network' });
  await expect(
    client.synthesize({ id: 1, format: 'pcm' as const, text: '', modelId: model, voiceId: voice, zdr: false }, signal()),
  ).rejects.toMatchObject({
    kind: 'invalid',
  });
  await expect(
    client.synthesize({ id: 1, format: 'pcm' as const, text: 'x', modelId: model, voiceId: 'bad\nvoice', zdr: false }, signal()),
  ).rejects.toMatchObject({
    kind: 'invalid',
  });
});
it.each([null, {}, { data: null }, { data: [null] }, { data: [{}] }, { data: [{ id: 1 }] }])(
  'rejects malformed catalog envelopes %#',
  async (value) => {
    const fetcher = vi.fn<typeof fetch>(async () => json(value));
    await expect(new OpenRouterClient(async () => 'key', fetcher, sharedDecoder).models(false, signal())).rejects.toMatchObject({
      kind: 'invalid',
    });
  },
);
it.each([
  { id: model, name: '', supported_voices: [] },
  { id: model, name: 'x', supported_voices: [1] },
  { id: model, name: 'x', supported_voices: ['bad\nvoice'] },
])('skips a malformed model entry without losing the catalog response %#', async (entry) => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ data: [entry] }));
  await expect(new OpenRouterClient(async () => 'key', fetcher, sharedDecoder).models(false, signal())).resolves.toEqual([]);
});
it('includes arbitrary advertised models and voices while preserving the account intersection', async () => {
  const extra = { id: 'vendor/new-speech-model', name: 'New voice', supported_voices: ['speaker/42 + natural'] };
  const excluded = { id: 'provider/account-only', name: 'Account only', supported_voices: ['other'] };
  const data = { data: [extra, excluded, { id: model, name: 'empty', supported_voices: [] }, ...catalog.data] };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(data))
    .mockResolvedValueOnce(json({ data: [extra, ...catalog.data] }));
  expect(await new OpenRouterClient(async () => 'key', fetcher, sharedDecoder).models(true, signal())).toEqual([
    { id: extra.id, name: extra.name, voices: [{ id: 'speaker/42 + natural', name: 'speaker/42 + natural' }] },
    { id: model, name: 'empty', voices: [] },
    { id: model, name: 'MAI', voices: [{ id: voice, name: voice }] },
  ]);
});
it('includes an account model without advertised voices instead of rejecting the catalog', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({ data: [{ id: 'vendor/default-voice', name: 'No voices', supported_voices: null }] }),
  );
  expect(await new OpenRouterClient(async () => 'key', fetcher, sharedDecoder).models(false, signal())).toEqual([
    { id: 'vendor/default-voice', name: 'No voices', voices: [] },
  ]);
});
it('rejects invalid content, excessive bytes and invalid PCM conversion', async () => {
  const responses = [
    new Response('x', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(15_360_001), { headers: { 'content-type': 'audio/pcm' } }),
    new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=3' } }),
    new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' } }),
  ];
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  const client = new OpenRouterClient(async () => 'key', fetcher, sharedDecoder);
  const request = { id: 1, format: 'pcm' as const, text: 'x', modelId: model, voiceId: voice, zdr: false };
  for (let index = 0; index < 3; index++) await expect(client.synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  sharedLease.decode.mockRejectedValueOnce(new Error('bad pcm'));
  await expect(client.synthesize(request, signal())).rejects.toThrow('bad pcm');
});
it('cancels before and during a stalled request', async () => {
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const client = new OpenRouterClient(async () => 'key', fetcher, sharedDecoder);
  const early = new AbortController();
  early.abort();
  await expect(client.models(false, early.signal)).rejects.toMatchObject({ kind: 'canceled' });
  const active = new AbortController();
  const pending = client.models(false, active.signal);
  active.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'canceled' });
});
it('times out a stalled request without leaking details', async () => {
  vi.useFakeTimers();
  try {
    const client = new OpenRouterClient(
      async () => 'key',
      () => new Promise(() => {}),
    );
    const pending = client.models(false, signal());
    const check = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  } finally {
    vi.useRealTimers();
  }
});

it('rejects missing content type and missing response body', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response())
    .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'application/json' } }));
  const client = new OpenRouterClient(async () => 'key', fetcher, sharedDecoder);
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'invalid' });
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'invalid' });
});
it('discards late responses after cancellation and timeout', async () => {
  vi.useFakeTimers();
  try {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = new OpenRouterClient(async () => 'key', fetcher, sharedDecoder);
    for (const timeout of [false, true]) {
      const controller = new AbortController();
      const pending = client.models(false, controller.signal);
      await Promise.resolve();
      const check = expect(pending).rejects.toMatchObject({ kind: timeout ? 'timeout' : 'canceled' });
      if (timeout) await vi.advanceTimersByTimeAsync(10_000);
      else controller.abort();
      await check;
      resolveFetch?.(new Response(new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(new Error('private')) })));
      await Promise.resolve();
    }
  } finally {
    vi.useRealTimers();
  }
});
it('ignores a key that arrives after timeout', async () => {
  vi.useFakeTimers();
  try {
    let resolveKey: ((key: string) => void) | undefined;
    const client = new OpenRouterClient(
      () =>
        new Promise((resolve) => {
          resolveKey = resolve;
        }),
    );
    const pending = client.models(false, signal());
    const check = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    resolveKey?.('key');
    await Promise.resolve();
  } finally {
    vi.useRealTimers();
  }
});

it('ignores rejected body and reader cancellation', async () => {
  const badBody = new ReadableStream<Uint8Array>({ cancel: rejectCancel });
  const badReader = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(15_360_001));
    },
    cancel: rejectCancel,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(badBody, { status: 500 }))
    .mockResolvedValueOnce(new Response(badReader, { headers: { 'content-type': 'audio/pcm' } }));
  const client = new OpenRouterClient(async () => 'key', fetcher, sharedDecoder);
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'network' });
  await expect(
    client.synthesize({ id: 1, format: 'pcm' as const, text: 'x', modelId: model, voiceId: voice, zdr: false }, signal()),
  ).rejects.toMatchObject({
    kind: 'invalid',
  });
});
it('discards an empty response arriving after cancellation', async () => {
  let resolveFetch: ((response: Response) => void) | undefined;
  const client = new OpenRouterClient(
    async () => 'key',
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = client.models(false, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'canceled' });
  resolveFetch?.(new Response(null));
  await Promise.resolve();
});

it('sends an opaque model identifier and voice without changing PCM policy', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' } }),
  );
  await new OpenRouterClient(async () => 'key', fetcher, sharedDecoder).synthesize(
    { id: 1, format: 'pcm' as const, text: 'x', modelId: 'vendor/new-speech-model', voiceId: 'voice/42 + natural', zdr: false },
    signal(),
  );
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('missing body');
  expect(openRouterSpeechRequest.parse(JSON.parse(body))).toEqual({
    model: 'vendor/new-speech-model',
    voice: 'voice/42 + natural',
    input: 'x',
    response_format: 'pcm',
  });
});
it('requires explicit 24 kHz mono metadata for dynamically discovered models', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  await expect(
    new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).synthesize(
      { id: 1, format: 'pcm' as const, text: 'x', modelId: 'vendor/new-speech-model', voiceId: 'speaker/42', zdr: false },
      signal(),
    ),
  ).rejects.toMatchObject({ kind: 'invalid' });
});
it('accepts a dynamically discovered model only when PCM metadata matches the playback contract', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' } }),
  );
  await expect(
    new OpenRouterClient(async () => 'secret', fetcher, sharedDecoder).synthesize(
      { id: 1, format: 'pcm' as const, text: 'x', modelId: 'vendor/new-speech-model', voiceId: 'speaker/42', zdr: false },
      signal(),
    ),
  ).resolves.toEqual({ wav: new Uint8Array([5]), durationMs: 601 });
});
it('reserves a decoder lease before the paid POST and retires it after decoding', async () => {
  const order: string[] = [];
  const lease = {
    signal: new AbortController().signal,
    decode: vi.fn<OpenRouterAudioDecodeLease['decode']>(async () => {
      order.push('decode');
      return { wav: new Uint8Array([7]), durationMs: 1000 };
    }),
    cancel: vi.fn(() => {
      order.push('cancel');
    }),
  };
  const decoder = {
    admit: vi.fn<OpenRouterAudioDecoder['admit']>(async () => {
      order.push('admit');
      return lease;
    }),
  };
  const fetcher = vi.fn<typeof fetch>(async () => {
    order.push('request');
    return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
  });
  const abort = new AbortController();
  const result = await new OpenRouterClient(async () => 'key', fetcher, decoder).synthesize(
    { id: 18, text: 'x', modelId: 'vendor/mp3-model', voiceId: 'speaker', zdr: false, format: 'mp3' },
    abort.signal,
  );
  expect(order).toEqual(['admit', 'request', 'decode', 'cancel']);
  expect(decoder.admit).toHaveBeenCalledWith(18, abort.signal);
  expect(lease.decode).toHaveBeenCalledWith({ format: 'mp3', bytes: new Uint8Array([1, 2]) }, expect.any(AbortSignal));
  expect(result).toEqual({ wav: new Uint8Array([7]), durationMs: 1000 });
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('missing body');
  expect(openRouterSpeechRequest.parse(JSON.parse(body)).response_format).toBe('mp3');
});

it('waits for per-request admission before reading credentials or making a paid request', async () => {
  let resolveAdmission: ((lease: OpenRouterAudioDecodeLease) => void) | undefined;
  const lease = {
    signal: new AbortController().signal,
    decode: vi.fn(async () => ({ wav: new Uint8Array([7]), durationMs: 1000 })),
    cancel: vi.fn(),
  };
  const decoder = {
    admit: vi.fn<OpenRouterAudioDecoder['admit']>(
      () =>
        new Promise((resolve) => {
          resolveAdmission = resolve;
        }),
    ),
  };
  const readKey = vi.fn(async () => 'key');
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([2]), { headers: { 'content-type': 'audio/mpeg' } }));
  const abort = new AbortController();
  const pending = new OpenRouterClient(readKey, fetcher, decoder).synthesize(
    { id: 3, text: 'x', modelId: 'vendor/mp3', voiceId: 'speaker', zdr: false, format: 'mp3' },
    abort.signal,
  );
  expect(decoder.admit).toHaveBeenCalledWith(3, abort.signal);
  expect(readKey).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  resolveAdmission?.(lease);
  await expect(pending).resolves.toEqual({ wav: new Uint8Array([7]), durationMs: 1000 });
  expect(lease.cancel).toHaveBeenCalledOnce();
});

it('does not pay if the admitted decoder document is destroyed while reading the key', async () => {
  let resolveKey: ((key: string) => void) | undefined;
  const admission = new AbortController();
  const decode = vi.fn(async () => ({ wav: new Uint8Array([7]), durationMs: 1000 }));
  const cancel = vi.fn(() => {
    admission.abort();
  });
  const lease: OpenRouterAudioDecodeLease = { signal: admission.signal, decode, cancel };
  const readKey = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveKey = resolve;
      }),
  );
  const fetcher = vi.fn<typeof fetch>();
  const client = new OpenRouterClient(readKey, fetcher, { admit: async () => lease });
  const pending = client.synthesize({ id: 21, text: 'x', modelId: 'vendor/mp3', voiceId: 'speaker', zdr: false, format: 'mp3' }, signal());
  await vi.waitFor(() => {
    expect(readKey.mock.calls).toHaveLength(1);
  });
  // A reload/disposal revokes the bridge lease while keychain IO is pending.
  admission.abort();
  resolveKey?.('key');
  await expect(pending).rejects.toMatchObject({ kind: 'canceled' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(decode.mock.calls).toHaveLength(0);
  expect(cancel.mock.calls).toHaveLength(1);
});

it('does not pay when decoder admission is missing, fails, or is canceled', async () => {
  const request = { id: 4, text: 'x', modelId: 'vendor/mp3', voiceId: 'speaker', zdr: false, format: 'mp3' as const };
  const fetcher = vi.fn<typeof fetch>();
  const key = vi.fn(async () => 'key');
  await expect(new OpenRouterClient(key, fetcher).synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  const decoder = {
    admit: vi.fn<OpenRouterAudioDecoder['admit']>(async () => {
      throw new Error('private');
    }),
  };
  await expect(new OpenRouterClient(key, fetcher, decoder).synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  const canceled = new AbortController();
  canceled.abort();
  await expect(new OpenRouterClient(key, fetcher, decoder).synthesize(request, canceled.signal)).rejects.toMatchObject({
    kind: 'canceled',
  });
  decoder.admit.mockRejectedValueOnce(new OpenRouterError('timeout'));
  await expect(new OpenRouterClient(key, fetcher, decoder).synthesize(request, signal())).rejects.toMatchObject({ kind: 'timeout' });
  expect(key).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('releases the lease on provider failure, cancellation, or decode failure', async () => {
  const request = { id: 5, text: 'x', modelId: 'vendor/mp3', voiceId: 'speaker', zdr: false, format: 'mp3' as const };
  const lease = {
    signal: new AbortController().signal,
    decode: vi.fn<OpenRouterAudioDecodeLease['decode']>(async () => {
      throw new Error('decode failed');
    }),
    cancel: vi.fn(),
  };
  const decoder = { admit: vi.fn(async () => lease) };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('private', { status: 500 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([2]), { headers: { 'content-type': 'audio/mpeg' } }));
  const client = new OpenRouterClient(async () => 'key', fetcher, decoder);
  await expect(client.synthesize(request, signal())).rejects.toMatchObject({ kind: 'network' });
  expect(lease.cancel).toHaveBeenCalledTimes(1);
  await expect(client.synthesize(request, signal())).rejects.toThrow('decode failed');
  expect(lease.cancel).toHaveBeenCalledTimes(2);
  const abort = new AbortController();
  abort.abort();
  await expect(client.synthesize(request, abort.signal)).rejects.toMatchObject({ kind: 'canceled' });
  expect(lease.cancel).toHaveBeenCalledTimes(3);
});

it('passes variable-rate stereo PCM through its admitted decoder lease', async () => {
  const lease = {
    signal: new AbortController().signal,
    decode: vi.fn<OpenRouterAudioDecodeLease['decode']>(async () => ({ wav: new Uint8Array([5]), durationMs: 601 })),
    cancel: vi.fn(),
  };
  const decoder = { admit: vi.fn<OpenRouterAudioDecoder['admit']>(async () => lease) };
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/pcm; rate=44100; channels=2' } }),
  );
  await new OpenRouterClient(async () => 'key', fetcher, decoder).synthesize(
    { id: 6, text: 'x', modelId: 'vendor/pcm', voiceId: '', zdr: false, format: 'pcm' },
    signal(),
  );
  expect(decoder.admit).toHaveBeenCalledOnce();
  expect(lease.decode).toHaveBeenCalledWith(
    { format: 'pcm', bytes: new Uint8Array([1, 0, 2, 0]), sampleRate: 44_100, channels: 2 },
    expect.any(AbortSignal),
  );
  expect(lease.cancel).toHaveBeenCalledOnce();
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('missing body');
  expect(openRouterSpeechRequest.parse(JSON.parse(body))).toEqual({ model: 'vendor/pcm', input: 'x', response_format: 'pcm' });
});

it('requires decoder admission before a PCM synthesis POST', async () => {
  const request = { id: 9, text: 'x', modelId: model, voiceId: voice, zdr: false, format: 'pcm' as const };
  const fetcher = vi.fn<typeof fetch>();
  const key = vi.fn(async () => 'key');
  await expect(new OpenRouterClient(key, fetcher).synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  const decoder = {
    admit: vi.fn<OpenRouterAudioDecoder['admit']>(async () => {
      throw new Error('not ready');
    }),
  };
  await expect(new OpenRouterClient(key, fetcher, decoder).synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  expect(decoder.admit).toHaveBeenCalledOnce();
  expect(key).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
