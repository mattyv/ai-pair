/* eslint-disable @typescript-eslint/require-await, unicorn/no-null -- Mocks match provider and Response APIs. */
import { afterEach, expect, it, vi } from 'vitest';
import { ElevenLabsClient } from '../src/speech_elevenlabs';
import { pcmToSpeech } from '../src/speech_pcm';

vi.mock('../src/speech_pcm', () => ({ pcmToSpeech: vi.fn(() => ({ wav: new Uint8Array([5]), durationMs: 601 })) }));
const key = 'test-only-secret';
function rejectedCancel(): Promise<void> {
  return Promise.reject(new Error('cancel failed'));
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('sends only the selected unit to the fixed endpoint using the secret header', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  const client = new ElevenLabsClient(async () => key, fetcher);
  const result = await client.synthesize({ text: 'One selected unit.', voiceId: 'voice-1', speed: 1.2 }, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledOnce();
  const call = fetcher.mock.calls[0];
  if (call === undefined) throw new Error('missing request');
  const [url, request] = call;
  expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=pcm_24000');
  expect(request?.redirect).toBe('error');
  expect(request?.headers).toMatchObject({ 'xi-api-key': key, 'content-type': 'application/json' });
  if (typeof request?.body !== 'string') throw new Error('missing body');
  expect(JSON.parse(request.body)).toEqual({
    text: 'One selected unit.',
    model_id: 'eleven_multilingual_v2',
    voice_settings: { speed: 1.2 },
  });
  expect(pcmToSpeech).toHaveBeenCalledWith(new Uint8Array([1, 0]));
  expect(result).toEqual({ wav: new Uint8Array([5]), durationMs: 601 });
});

it('lists only bounded fields and exposes the next cursor', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          voices: [{ voice_id: 'id', name: 'Name', category: 'premade', preview_url: 'https://example.test/secret' }],
          has_more: true,
          next_page_token: 'next',
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const client = new ElevenLabsClient(async () => key, fetcher);
  expect(await client.voices(undefined, new AbortController().signal)).toEqual({
    voices: [{ id: 'id', name: 'Name', category: 'premade' }],
    nextCursor: 'next',
  });
});

it('never calls the provider when the key or voice is missing', async () => {
  const fetcher = vi.fn();
  const client = new ElevenLabsClient(async () => undefined, fetcher);
  await expect(client.synthesize({ text: 'text', voiceId: '', speed: 1 }, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  [401, 'auth'],
  [403, 'auth'],
  [404, 'auth'],
  [429, 'rate'],
  [500, 'network'],
] as const)('sanitizes HTTP %s without leaking the provider response', async (status, kind) => {
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response('secret body', { status })));
  const client = new ElevenLabsClient(() => Promise.resolve(key), fetcher);
  await expect(client.synthesize({ text: 'private', voiceId: 'voice', speed: 1 }, new AbortController().signal)).rejects.toMatchObject({
    kind,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('rejects malformed content types and oversized audio without converting it', async () => {
  for (const response of [
    new Response('bad', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(1_920_001), { headers: { 'content-type': 'audio/pcm' } }),
  ]) {
    const client = new ElevenLabsClient(
      () => Promise.resolve(key),
      vi.fn<typeof fetch>(() => Promise.resolve(response)),
    );
    await expect(client.synthesize({ text: 'private', voiceId: 'voice', speed: 1 }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid',
    });
  }
  expect(pcmToSpeech).not.toHaveBeenCalled();
});

it('sanitizes PCM conversion failures', async () => {
  vi.mocked(pcmToSpeech).mockImplementationOnce(() => {
    throw new Error('private');
  });
  const client = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(new Uint8Array([0, 0]), { headers: { 'content-type': 'audio/pcm' } }))),
  );
  await expect(client.synthesize({ text: 'private', voiceId: 'voice', speed: 1 }, new AbortController().signal)).rejects.toMatchObject({
    kind: 'invalid',
  });
});

it('rejects invalid catalog payloads and pagination cycles', async () => {
  for (const payload of [
    { voices: [], has_more: true, next_page_token: 'same' },
    { voices: [{ voice_id: '../unsafe', name: 'Name' }], has_more: false },
    { voices: 'wrong', has_more: false },
  ]) {
    const client = new ElevenLabsClient(
      () => Promise.resolve(key),
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })),
      ),
    );
    await expect(client.voices('same', new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' });
  }
});

it('does not send when aborted while the key is being retrieved', async () => {
  const pending = Promise.withResolvers<string | undefined>();
  const fetcher = vi.fn<typeof fetch>();
  const controller = new AbortController();
  const client = new ElevenLabsClient(() => pending.promise, fetcher);
  const response = client.voices(undefined, controller.signal);
  controller.abort();
  await expect(response).rejects.toMatchObject({ kind: 'canceled' });
  pending.resolve(key);
  await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
});

it('times out a stalled request without retrying', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const client = new ElevenLabsClient(() => Promise.resolve(key), fetcher);
    const response = client.synthesize({ text: 'hello', voiceId: 'voice', speed: 1 }, new AbortController().signal);
    const assertion = expect(response).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('handles empty catalogs and rejects invalid cursors or categories', async () => {
  const responses = [
    { voices: [], has_more: false },
    { voices: [{ voice_id: 'id', name: 'Name', category: 9 }], has_more: false },
  ];
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(responses.shift()), { headers: { 'content-type': 'application/json' } })),
  );
  const client = new ElevenLabsClient(() => Promise.resolve(key), fetcher);
  expect(await client.voices(undefined, new AbortController().signal)).toEqual({ voices: [] });
  await expect(client.voices('next', new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' });
  await expect(client.voices('', new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('handles a pre-aborted signal and a missing key without network access', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  const client = new ElevenLabsClient(() => Promise.resolve(undefined), fetcher);
  await expect(client.voices(undefined, controller.signal)).rejects.toMatchObject({ kind: 'canceled' });
  await expect(client.voices(undefined, new AbortController().signal)).rejects.toMatchObject({ kind: 'key' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('sanitizes a transport rejection and missing response body', async () => {
  const failing = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() => Promise.reject(new Error('sensitive internal detail'))),
  );
  await expect(failing.voices(undefined, new AbortController().signal)).rejects.toMatchObject({ kind: 'network' });
  const empty = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }))),
  );
  await expect(empty.voices(undefined, new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' });
});

it('discards a response that arrives after the request was canceled', async () => {
  const pending = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const client = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() => pending.promise),
  );
  const result = client.voices(undefined, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(result).rejects.toMatchObject({ kind: 'canceled' });
  pending.resolve(
    new Response(new ReadableStream({ cancel: () => Promise.reject(new Error('late cancel failed')) }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  await Promise.resolve();
  await Promise.resolve();
});

it('cancels an error response body instead of reading provider error text', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const client = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status: 401 }))),
  );
  await expect(client.voices(undefined, new AbortController().signal)).rejects.toMatchObject({ kind: 'auth' });
  expect(cancel).toHaveBeenCalledOnce();
});

it('accepts a voice with no optional category', async () => {
  const client = new ElevenLabsClient(
    () => Promise.resolve(key),
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ voices: [{ voice_id: 'id', name: 'Name' }], has_more: false }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  expect(await client.voices(undefined, new AbortController().signal)).toEqual({ voices: [{ id: 'id', name: 'Name' }] });
});

it('closes a delayed response after the deadline even if fetch ignores abort', async () => {
  vi.useFakeTimers();
  try {
    const pending = Promise.withResolvers<Response>();
    const client = new ElevenLabsClient(
      () => Promise.resolve(key),
      vi.fn<typeof fetch>(() => pending.promise),
    );
    const result = client.voices(undefined, new AbortController().signal);
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    pending.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
  } finally {
    vi.useRealTimers();
  }
});

it('ignores failures while closing error bodies and oversized readers', async () => {
  const errorBody = new ReadableStream<Uint8Array>({ cancel: rejectedCancel });
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_920_001));
    },
    cancel: rejectedCancel,
  });
  for (const response of [
    new Response(errorBody, { status: 401 }),
    new Response(oversized, { headers: { 'content-type': 'audio/pcm' } }),
  ]) {
    const client = new ElevenLabsClient(
      () => Promise.resolve(key),
      vi.fn<typeof fetch>(() => Promise.resolve(response)),
    );
    await expect(client.synthesize({ text: 'test', voiceId: 'voice', speed: 1 }, new AbortController().signal)).rejects.toThrow();
  }
  await Promise.resolve();
});

it('does not dispatch if key retrieval completes after its deadline', async () => {
  vi.useFakeTimers();
  try {
    const pending = Promise.withResolvers<string | undefined>();
    const fetcher = vi.fn<typeof fetch>();
    const client = new ElevenLabsClient(() => pending.promise, fetcher);
    const result = client.voices(undefined, new AbortController().signal);
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    pending.resolve(key);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
