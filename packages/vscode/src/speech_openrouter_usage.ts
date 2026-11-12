import { openRouterGeneration } from '@ai-pair/protocol';

const GENERATION_URL = 'https://openrouter.ai/api/v1/generation';
const MAX_ID_LENGTH = 256;
const MAX_RESPONSE_BYTES = 65_536;
const LOOKUP_TIMEOUT_MS = 5000;
// The bounded exponential schedule is the retry policy.
// oxlint-disable-next-line eslint/no-magic-numbers
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
// HTTP status 404 means the generation may not yet be published.
// oxlint-disable-next-line eslint/no-magic-numbers
const NOT_FOUND = 404;

/** Retrieves only the confirmed charge for a matching OpenRouter generation. */
export class OpenRouterUsage {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  /** Looks up a charge with the credential captured by its synthesis request. */
  async cost(id: string, key: string): Promise<number | 'generation-not-published' | undefined> {
    if (id.length === 0 || id.length > MAX_ID_LENGTH || /\p{Cc}/u.test(id)) return undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await this.lookup(id, key);
      if (result !== 'retry') return result;
      if (attempt + 1 < MAX_ATTEMPTS) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
        });
      }
    }
    return 'generation-not-published';
  }

  private async lookup(id: string, key: string): Promise<number | 'retry' | undefined> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timer = setTimeout(() => {
      controller.abort();
    }, LOOKUP_TIMEOUT_MS);
    const aborted = new Promise<undefined>((resolve) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          resolve(undefined);
        },
        { once: true },
      );
    });
    const request = async (): Promise<number | 'retry' | undefined> => {
      const url = new URL(GENERATION_URL);
      url.searchParams.set('id', id);
      const response = await this.fetcher(url.toString(), {
        headers: { authorization: `Bearer ${key}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        if (response.body !== null) void response.body.cancel().catch(() => {});
        return undefined;
      }
      if (response.status === NOT_FOUND) return 'retry';
      if (!response.ok || response.body === null) return undefined;
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) return undefined;
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const parsed = openRouterGeneration.safeParse(value);
      return parsed.success && parsed.data.data.id === id ? parsed.data.data.total_cost : undefined;
    };
    try {
      return await Promise.race([request().catch(() => undefined), aborted]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader !== undefined) void reader.cancel().catch(() => {});
    }
  }
}
