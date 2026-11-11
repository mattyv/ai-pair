import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '@ai-pair/protocol';
/* eslint-disable @typescript-eslint/require-await, unicorn/no-null -- Provider and Response mocks. */
import { afterEach, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../src/speech_openrouter';
import { pcmToSpeech } from '../src/speech_pcm';

vi.mock('../src/speech_pcm', () => ({ pcmToSpeech: vi.fn(() => ({ wav: new Uint8Array([5]), durationMs: 601 })) }));
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
  expect(await new OpenRouterClient(async () => 'secret', fetcher).models(false, signal())).toEqual([
    { id: model, name: 'MAI', voices: [{ id: voice, name: voice }] },
  ]);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/models/user?output_modalities=speech');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer secret' }, redirect: 'error' });
});
it('ZdrSelection intersects the authenticated catalog with the public ZDR catalog', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(catalog))
    .mockResolvedValueOnce(json({ data: [] }));
  expect(await new OpenRouterClient(async () => 'secret', fetcher).models(true, signal())).toEqual([]);
  expect(fetcher.mock.calls[1]?.[0]).toContain('zdr=true');
});
it('AccountOnly never falls back when authentication fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('secret body', { status: 401 }));
  await expect(new OpenRouterClient(async () => 'secret', fetcher).models(true, signal())).rejects.toMatchObject({ kind: 'auth' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('PolicySampled sends the selected request and converts documented PCM', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  const result = await new OpenRouterClient(async () => 'secret', fetcher).synthesize(
    { text: 'private', modelId: model, voiceId: voice, zdr: true },
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
  expect(pcmToSpeech).toHaveBeenCalledWith(new Uint8Array([1, 0]));
  expect(result).toEqual({ wav: new Uint8Array([5]), durationMs: 601 });
});
it('rejects incompatible audio metadata and unsupported models', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm; rate=44100; channels=1' } }),
  );
  const client = new OpenRouterClient(async () => 'secret', fetcher);
  await expect(client.synthesize({ text: 'x', modelId: model, voiceId: voice, zdr: false }, signal())).rejects.toMatchObject({
    kind: 'invalid',
  });
  await expect(client.synthesize({ text: 'x', modelId: 'unknown', voiceId: voice, zdr: false }, signal())).rejects.toMatchObject({
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
  await expect(new OpenRouterClient(async () => 'secret', fetcher).models(false, signal())).rejects.toMatchObject({ kind });
});
it('rejects absent credentials, rejected fetch and bad request arguments', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('secret');
  });
  await expect(new OpenRouterClient(async () => undefined, fetcher).models(false, signal())).rejects.toMatchObject({ kind: 'key' });
  await expect(new OpenRouterClient(async () => '', fetcher).models(false, signal())).rejects.toMatchObject({ kind: 'key' });
  const client = new OpenRouterClient(async () => 'secret', fetcher);
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'network' });
  await expect(client.synthesize({ text: '', modelId: model, voiceId: voice, zdr: false }, signal())).rejects.toMatchObject({
    kind: 'invalid',
  });
  await expect(client.synthesize({ text: 'x', modelId: model, voiceId: '', zdr: false }, signal())).rejects.toMatchObject({
    kind: 'invalid',
  });
});
it.each([
  null,
  {},
  { data: null },
  { data: [null] },
  { data: [{}] },
  { data: [{ id: 1 }] },
  { data: [{ id: model }] },
  { data: [{ id: model, name: '', supported_voices: [] }] },
  { data: [{ id: model, name: 'x', supported_voices: [1] }] },
  { data: [{ id: model, name: 'x', supported_voices: ['!'] }] },
])('rejects malformed catalog %#', async (value) => {
  const fetcher = vi.fn<typeof fetch>(async () => json(value));
  await expect(new OpenRouterClient(async () => 'key', fetcher).models(false, signal())).rejects.toMatchObject({ kind: 'invalid' });
});
it('omits unsupported and voiceless models and retains the account intersection', async () => {
  const data = { data: [{ id: 'other' }, { id: model, name: 'empty', supported_voices: [] }, ...catalog.data] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(data)).mockResolvedValueOnce(json(catalog));
  expect(await new OpenRouterClient(async () => 'key', fetcher).models(true, signal())).toHaveLength(1);
});
it('rejects invalid content, excessive bytes and invalid PCM conversion', async () => {
  const responses = [
    new Response('x', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(1_920_001), { headers: { 'content-type': 'audio/pcm' } }),
    new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=2' } }),
    new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' } }),
  ];
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  const client = new OpenRouterClient(async () => 'key', fetcher);
  const request = { text: 'x', modelId: model, voiceId: voice, zdr: false };
  for (let index = 0; index < 3; index++) await expect(client.synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
  vi.mocked(pcmToSpeech).mockImplementationOnce(() => {
    throw new Error('bad pcm');
  });
  await expect(client.synthesize(request, signal())).rejects.toMatchObject({ kind: 'invalid' });
});
it('cancels before and during a stalled request', async () => {
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const client = new OpenRouterClient(async () => 'key', fetcher);
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
  const client = new OpenRouterClient(async () => 'key', fetcher);
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
    const client = new OpenRouterClient(async () => 'key', fetcher);
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
      controller.enqueue(new Uint8Array(1_920_001));
    },
    cancel: rejectCancel,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(badBody, { status: 500 }))
    .mockResolvedValueOnce(new Response(badReader, { headers: { 'content-type': 'audio/pcm' } }));
  const client = new OpenRouterClient(async () => 'key', fetcher);
  await expect(client.models(false, signal())).rejects.toMatchObject({ kind: 'network' });
  await expect(client.synthesize({ text: 'x', modelId: model, voiceId: voice, zdr: false }, signal())).rejects.toMatchObject({
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

it('omits provider policy when ZDR is off', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  await new OpenRouterClient(async () => 'key', fetcher).synthesize({ text: 'x', modelId: model, voiceId: voice, zdr: false }, signal());
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('missing body');
  expect(openRouterSpeechRequest.parse(JSON.parse(body))).toEqual({ model, voice, input: 'x', response_format: 'pcm' });
});
