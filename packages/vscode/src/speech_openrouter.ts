import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '@ai-pair/protocol';
import { pcmToSpeech } from './speech_pcm';
import type { OpenRouterModel, OpenRouterSpeechPort, SpeechAudioResult } from './speech_types';

const ORIGIN = 'https://openrouter.ai/api/v1';
const SYNTHESIS_TIMEOUT_MS = 20_000;
const CATALOG_TIMEOUT_MS = 10_000;
const MAX_PCM_BYTES = 1_920_000;
const MAX_CATALOG_BYTES = 1_048_576;
/** Models whose documented default PCM contract is 24 kHz mono. */
const DOCUMENTED_PCM_MODELS = new Set(['microsoft/mai-voice-2', 'microsoft/mai-voice-2.1', 'microsoft/mai-voice-2.1-flash']);
// HTTP status values are protocol-defined.
// oxlint-disable-next-line eslint/no-magic-numbers
const AUTH_STATUSES = new Set([401, 403, 404]);
// oxlint-disable-next-line eslint/no-magic-numbers
const RATE_LIMIT_STATUS = 429;

/** Safe categories for provider failures. */
export type OpenRouterErrorKind = 'key' | 'auth' | 'rate' | 'network' | 'timeout' | 'invalid' | 'canceled';
/** Contains no provider payload, credential, text, or URL. */
export class OpenRouterError extends Error {
  constructor(readonly kind: OpenRouterErrorKind) {
    super(`OpenRouter request failed: ${kind}.`);
  }
}

/** Owns the fixed endpoints and bounded responses for an account. */
export class OpenRouterClient implements OpenRouterSpeechPort {
  constructor(
    private readonly readKey: () => Promise<string | undefined>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async synthesize(
    request: { text: string; modelId: string; voiceId: string; zdr: boolean },
    signal: AbortSignal,
  ): Promise<SpeechAudioResult> {
    const payload = openRouterSpeechRequest.safeParse({
      model: request.modelId,
      voice: request.voiceId,
      input: request.text,
      response_format: 'pcm',
      ...(request.zdr ? { provider: { zdr: true } } : {}),
    });
    if (!payload.success) throw new OpenRouterError('invalid');
    // OpenRouterSpeech: Synthesize samples the request policy.
    const bytes = await this.request(
      `${ORIGIN}/audio/speech`,
      'POST',
      payload.data,
      signal,
      SYNTHESIS_TIMEOUT_MS,
      MAX_PCM_BYTES,
      'audio',
      DOCUMENTED_PCM_MODELS.has(request.modelId),
    );
    try {
      return pcmToSpeech(bytes);
    } catch {
      throw new OpenRouterError('invalid');
    }
  }

  async models(zdr: boolean, signal: AbortSignal): Promise<OpenRouterModel[]> {
    // OpenRouterSpeech: Authenticate precedes any selection or public narrowing.
    const account = await this.catalog(`${ORIGIN}/models/user?output_modalities=speech`, signal);
    if (!zdr) return account;
    // OpenRouterSpeech: Narrow only removes account-eligible models.
    const allowed = await this.catalogIds(`${ORIGIN}/models?output_modalities=speech&zdr=true`, signal);
    return account.filter((model) => allowed.has(model.id));
  }

  private async catalog(url: string, signal: AbortSignal): Promise<OpenRouterModel[]> {
    const bytes = await this.request(url, 'GET', undefined, signal, CATALOG_TIMEOUT_MS, MAX_CATALOG_BYTES, 'json');
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const catalog = openRouterCatalog.parse(value);
      const models: OpenRouterModel[] = [];
      for (const item of catalog.data) {
        const parsed = openRouterSpeechModel.safeParse(item);
        if (!parsed.success) continue;
        const model = parsed.data;
        const voices = (model.supported_voices ?? []).map((voice) => ({ id: voice, name: voice }));
        if (voices.length > 0) models.push({ id: model.id, name: model.name, voices });
      }
      return models;
    } catch {
      throw new OpenRouterError('invalid');
    }
  }

  private async catalogIds(url: string, signal: AbortSignal): Promise<Set<string>> {
    const bytes = await this.request(url, 'GET', undefined, signal, CATALOG_TIMEOUT_MS, MAX_CATALOG_BYTES, 'json');
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return new Set(openRouterCatalog.parse(value).data.map((item) => item.id));
    } catch {
      throw new OpenRouterError('invalid');
    }
  }

  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal: AbortSignal,
    deadline: number,
    limit: number,
    kind: 'audio' | 'json',
    documentedPcmContract = false,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    let timedOut = false;
    function onAbort(): void {
      controller.abort();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadline);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseBody: ReadableStream<Uint8Array> | undefined;
    const abort = new Promise<never>((_, reject) => {
      function fail(): void {
        reject(new OpenRouterError(timedOut ? 'timeout' : 'canceled'));
      }
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    const operation = async (): Promise<Uint8Array> => {
      const key = await this.readKey();
      if (controller.signal.aborted) throw new OpenRouterError(timedOut ? 'timeout' : 'canceled');
      if (key === undefined || key.length === 0) throw new OpenRouterError('key');
      const headers: Record<string, string> = { authorization: `Bearer ${key}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await this.fetcher(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      responseBody = response.body ?? undefined;
      if (controller.signal.aborted) {
        if (response.body !== null) void response.body.cancel().catch(() => {});
        throw new OpenRouterError(timedOut ? 'timeout' : 'canceled');
      }
      if (!response.ok) {
        if (AUTH_STATUSES.has(response.status)) throw new OpenRouterError('auth');
        if (response.status === RATE_LIMIT_STATUS) throw new OpenRouterError('rate');
        throw new OpenRouterError('network');
      }
      const contentType = response.headers.get('content-type') ?? '';
      const type = contentType.split(';')[0]?.trim().toLowerCase();
      if (kind === 'audio') {
        let hasRate = false;
        let hasChannels = false;
        for (const part of contentType.split(';').slice(1)) {
          const [parameter, value] = part.trim().toLowerCase().split('=');
          if (parameter === 'rate') hasRate = value === '24000';
          if (parameter === 'channels') hasChannels = value === '1';
          if ((parameter === 'rate' && !hasRate) || (parameter === 'channels' && !hasChannels)) {
            throw new OpenRouterError('invalid');
          }
        }
        if (!documentedPcmContract && (!hasRate || !hasChannels)) throw new OpenRouterError('invalid');
      }
      if (kind === 'json' ? type !== 'application/json' : type !== 'audio/pcm') {
        throw new OpenRouterError('invalid');
      }
      if (response.body === null) throw new OpenRouterError('invalid');
      reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) throw new OpenRouterError('invalid');
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    };
    try {
      return await Promise.race([operation(), abort]);
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      throw new OpenRouterError('network');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (reader !== undefined) void reader.cancel().catch(() => {});
      else if (responseBody !== undefined) void responseBody.cancel().catch(() => {});
      controller.abort();
    }
  }
}
