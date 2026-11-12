/* eslint-disable unicorn/no-null -- Response uses null for an absent body. */
import { afterEach, expect, it, vi } from 'vitest';
import { OpenRouterUsage } from '../src/speech_openrouter_usage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses the default fetch when no test transport is supplied', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'gen-tts-1', total_cost: 0 } }))),
  );
  expect(await new OpenRouterUsage().cost('gen-tts-1', 'key')).toBe(0);
});

it('reads the matching provider-reported cost with the original request credential', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data: { id: 'gen-tts-1', total_cost: 0.012, extra: true } }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  expect(await new OpenRouterUsage(fetcher).cost('gen-tts-1', 'old-key')).toBe(0.012);
  expect(fetcher).toHaveBeenCalledWith(
    'https://openrouter.ai/api/v1/generation?id=gen-tts-1',
    expect.objectContaining({ headers: { authorization: 'Bearer old-key' }, redirect: 'error' }),
  );
});

it.each([{ id: 'other', total_cost: 1 }, { id: 'gen-tts-1', total_cost: -1 }, { id: 'gen-tts-1', total_cost: '1' }, { id: 'gen-tts-1' }])(
  'does not count mismatched or invalid provider data %#',
  async (data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data })));
    expect(await new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key')).toBeUndefined();
  },
);

it('retries a not-yet-published generation and accepts a free charge', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'gen-tts-1', total_cost: 0 } })));
  const result = new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key');
  await vi.runAllTimersAsync();
  expect(await result).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('returns unavailable for a missing ID, a failed request, or a stalled provider', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('private'))
    .mockReturnValueOnce(new Promise(() => {}));
  const usage = new OpenRouterUsage(fetcher);
  expect(await usage.cost('', 'key')).toBeUndefined();
  expect(await usage.cost('x'.repeat(257), 'key')).toBeUndefined();
  expect(await usage.cost('bad\nid', 'key')).toBeUndefined();
  expect(await usage.cost('gen-tts-1', 'key')).toBeUndefined();
  const stalled = usage.cost('gen-tts-2', 'key');
  await vi.runAllTimersAsync();
  expect(await stalled).toBeUndefined();
});

it('bounds retries, malformed bodies and error responses', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  const pending = new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key');
  await vi.runAllTimersAsync();
  expect(await pending).toBe('generation-not-published');
  expect(fetcher).toHaveBeenCalledTimes(5);
  for (const response of [new Response('', { status: 500 }), new Response(null, { status: 204 }), new Response('invalid')]) {
    fetcher.mockResolvedValueOnce(response);
    expect(await new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key')).toBeUndefined();
  }
});

it('bounds response bytes and tolerates a body that fails to cancel', async () => {
  const cancel = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('private'));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(65_537));
    },
    cancel,
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
  expect(await new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key')).toBeUndefined();
  expect(cancel).toHaveBeenCalledOnce();
});

it('retires a provider response that arrives after its timeout', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<Response>();
  const cancel = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('private'));
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  const result = new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key');
  await vi.runAllTimersAsync();
  expect(await result).toBeUndefined();
  pending.resolve(new Response(new ReadableStream<Uint8Array>({ cancel })));
  await Promise.resolve();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
});

it('ignores a late empty response after timeout', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  const result = new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key');
  await vi.runAllTimersAsync();
  expect(await result).toBeUndefined();
  pending.resolve(new Response(null, { status: 204 }));
  await Promise.resolve();
  await Promise.resolve();
});

it('reports unpublished generations after bounded exponential retries', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  const result = new OpenRouterUsage(fetcher).cost('gen-tts-1', 'key');
  await vi.advanceTimersByTimeAsync(14_999);
  expect(fetcher).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe('generation-not-published');
  expect(fetcher).toHaveBeenCalledTimes(5);
});
