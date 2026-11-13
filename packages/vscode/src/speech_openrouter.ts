import type { SpeechCostResult } from './session_speech_cost';
import { openRouterCatalog, openRouterSpeechModel, openRouterSpeechRequest } from '@ai-pair/protocol';
import { OpenRouterUsage } from './speech_openrouter_usage';
import type {
  OpenRouterAudioDecoder,
  OpenRouterAudioFormat,
  OpenRouterModel,
  OpenRouterSpeechPort,
  SpeechAudioResult,
} from './speech_types';

const ORIGIN = 'https://openrouter.ai/api/v1';
const SYNTHESIS_TIMEOUT_MS = 20_000;
const CATALOG_TIMEOUT_MS = 10_000;
const MAX_MP3_BYTES = 1_920_000;
const MAX_PCM_BYTES = 15_360_000;
const MAX_CATALOG_BYTES = 1_048_576;
const MIN_PCM_RATE = 8000;
const MAX_PCM_RATE = 96_000;
const DOCUMENTED_PCM_RATE = 24_000;
/** Models whose documented default PCM contract is 24 kHz mono. */
const DOCUMENTED_PCM_MODELS = new Set(['microsoft/mai-voice-2', 'microsoft/mai-voice-2.1', 'microsoft/mai-voice-2.1-flash']);
// HTTP status values are protocol-defined.
// oxlint-disable-next-line eslint/no-magic-numbers
const AUTH_STATUSES = new Set([401, 403, 404]);
// oxlint-disable-next-line eslint/no-magic-numbers
const RATE_LIMIT_STATUS = 429;
interface JsonResponse {
  kind: 'json';
  bytes: Uint8Array;
}
interface Mp3Response {
  kind: 'mp3';
  bytes: Uint8Array;
}
interface PcmResponse {
  kind: 'pcm';
  bytes: Uint8Array;
  sampleRate: number;
  channels: number;
}
type AudioResponse = Mp3Response | PcmResponse;
type CostDispatch = () => ((cost: SpeechCostResult) => void) | undefined;
interface RequestOptions {
  documentedPcmContract?: boolean;
  beginCost?: CostDispatch;
}

/** Safe categories for provider failures. */
export type OpenRouterErrorKind = 'key' | 'auth' | 'rate' | 'network' | 'timeout' | 'invalid' | 'canceled';
/** Contains no provider payload, credential, text, or URL. */
export class OpenRouterError extends Error {
  constructor(readonly kind: OpenRouterErrorKind) {
    super(`OpenRouter request failed: ${kind}.`);
  }
}

/** Links caller cancellation with local document/lease retirement. */
function linkSignals(first: AbortSignal, second: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  function abort(): void {
    controller.abort();
  }
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  if (first.aborted || second.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort);
      second.removeEventListener('abort', abort);
    },
  };
}

/** Owns the fixed endpoints and bounded responses for an account. */
export class OpenRouterClient implements OpenRouterSpeechPort {
  constructor(
    private readonly readKey: () => Promise<string | undefined>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly decoder?: OpenRouterAudioDecoder,
    private readonly captureCost?: () => CostDispatch | undefined,
    private readonly usage: Pick<OpenRouterUsage, 'cost'> = new OpenRouterUsage(fetcher),
  ) {}

  async synthesize(
    request: {
      id: number;
      text: string;
      modelId: string;
      voiceId: string;
      zdr: boolean;
      format: OpenRouterAudioFormat;
      purpose?: 'narration' | 'preview';
      previousText?: string;
    },
    signal: AbortSignal,
  ): Promise<SpeechAudioResult> {
    const payload = openRouterSpeechRequest.safeParse({
      model: request.modelId,
      ...(request.voiceId === '' ? {} : { voice: request.voiceId }),
      input: request.text,
      response_format: request.format,
      ...(request.zdr || request.previousText !== undefined
        ? {
            provider: {
              zdr: request.zdr,
              ...(request.previousText === undefined ? {} : { options: { elevenlabs: { previous_text: request.previousText } } }),
            },
          }
        : {}),
    });
    if (!payload.success) throw new OpenRouterError('invalid');
    const decoder = this.decoder;
    if (decoder === undefined) throw new OpenRouterError('invalid');
    let beginCost: CostDispatch | undefined;
    if (request.purpose === 'narration') {
      try {
        beginCost = this.captureCost?.();
      } catch {
        // Cost reporting is optional and cannot prevent speech.
      }
    }
    // OpenRouterDecode, Admit: reserve local decode capacity before the paid provider POST.
    const lease = await decoder.admit(request.id, signal).catch((error: unknown) => {
      if (error instanceof OpenRouterError) throw error;
      throw new OpenRouterError(signal.aborted ? 'canceled' : 'invalid');
    });
    const linked = linkSignals(signal, lease.signal);
    try {
      if (linked.signal.aborted) throw new OpenRouterError('canceled');
      // OpenRouterSpeech: Synthesize samples the request policy.
      const response =
        request.format === 'mp3'
          ? await this.request(`${ORIGIN}/audio/speech`, 'POST', payload.data, linked.signal, SYNTHESIS_TIMEOUT_MS, MAX_MP3_BYTES, 'mp3', {
              beginCost,
            })
          : await this.request(`${ORIGIN}/audio/speech`, 'POST', payload.data, linked.signal, SYNTHESIS_TIMEOUT_MS, MAX_PCM_BYTES, 'pcm', {
              documentedPcmContract: DOCUMENTED_PCM_MODELS.has(request.modelId),
              beginCost,
            });
      if (response.kind === 'mp3') return await lease.decode({ format: 'mp3', bytes: response.bytes }, linked.signal);
      return await lease.decode(
        { format: 'pcm', bytes: response.bytes, sampleRate: response.sampleRate, channels: response.channels },
        linked.signal,
      );
    } finally {
      linked.dispose();
      lease.cancel();
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
    const { bytes } = await this.request(url, 'GET', undefined, signal, CATALOG_TIMEOUT_MS, MAX_CATALOG_BYTES, 'json');
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const catalog = openRouterCatalog.parse(value);
      const models: OpenRouterModel[] = [];
      for (const item of catalog.data) {
        const parsed = openRouterSpeechModel.safeParse(item);
        if (!parsed.success) continue;
        const model = parsed.data;
        const voices = (model.supported_voices ?? []).map((voice) => ({ id: voice, name: voice }));
        const pricing = model.pricing;
        const hasAdvertisedRate = pricing?.prompt !== undefined || pricing?.completion !== undefined;
        models.push({ id: model.id, name: model.name, voices, ...(hasAdvertisedRate ? { pricing } : {}) });
      }
      return models;
    } catch {
      throw new OpenRouterError('invalid');
    }
  }

  private async catalogIds(url: string, signal: AbortSignal): Promise<Set<string>> {
    const { bytes } = await this.request(url, 'GET', undefined, signal, CATALOG_TIMEOUT_MS, MAX_CATALOG_BYTES, 'json');
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
    kind: 'json',
    options?: RequestOptions,
  ): Promise<JsonResponse>;
  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal: AbortSignal,
    deadline: number,
    limit: number,
    kind: 'mp3',
    options?: RequestOptions,
  ): Promise<Mp3Response>;
  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal: AbortSignal,
    deadline: number,
    limit: number,
    kind: 'pcm',
    options?: RequestOptions,
  ): Promise<PcmResponse>;
  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal: AbortSignal,
    deadline: number,
    limit: number,
    kind: OpenRouterAudioFormat | 'json',
    options: RequestOptions = {},
  ): Promise<JsonResponse | AudioResponse> {
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
    let pendingCost: ((cost: SpeechCostResult) => void) | undefined;
    let generation: { id: string; key: string } | undefined;
    function finishCost(cost: SpeechCostResult): void {
      const finish = pendingCost;
      pendingCost = undefined;
      try {
        finish?.(cost);
      } catch {
        // Cost display cannot affect speech.
      }
    }
    const abort = new Promise<never>((_, reject) => {
      function fail(): void {
        reject(new OpenRouterError(timedOut ? 'timeout' : 'canceled'));
      }
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    const operation = async (): Promise<JsonResponse | AudioResponse> => {
      const key = await this.readKey();
      if (controller.signal.aborted) throw new OpenRouterError(timedOut ? 'timeout' : 'canceled');
      if (key === undefined || key.length === 0) throw new OpenRouterError('key');
      const headers: Record<string, string> = { authorization: `Bearer ${key}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (options.beginCost !== undefined) {
        try {
          pendingCost = options.beginCost();
        } catch {
          // An observer is optional and cannot prevent speech.
        }
      }
      const response = await this.fetcher(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (pendingCost !== undefined && response.ok) {
        const id = response.headers.get('x-generation-id');
        if (id !== null && id !== '') generation = { id, key };
        else finishCost('missing-generation-id');
      }
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
      let sampleRate: number | undefined;
      let channels: number | undefined;
      if (kind === 'pcm') {
        for (const part of contentType.split(';').slice(1)) {
          const [parameter, value] = part.trim().toLowerCase().split('=');
          if (parameter === 'rate' && value !== undefined) sampleRate = Number(value);
          if (parameter === 'channels' && value !== undefined) channels = Number(value);
        }
        if (options.documentedPcmContract === true && sampleRate === undefined && channels === undefined) {
          sampleRate = DOCUMENTED_PCM_RATE;
          channels = 1;
        }
        if (
          sampleRate === undefined ||
          !Number.isInteger(sampleRate) ||
          sampleRate < MIN_PCM_RATE ||
          sampleRate > MAX_PCM_RATE ||
          channels === undefined ||
          !Number.isInteger(channels) ||
          (channels !== 1 && channels !== 2)
        ) {
          throw new OpenRouterError('invalid');
        }
      }
      const validContentType =
        kind === 'json' ? type === 'application/json' : kind === 'pcm' ? type === 'audio/pcm' : type === 'audio/mpeg';
      if (!validContentType) {
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
      if (kind === 'json') return { kind: 'json', bytes };
      if (kind === 'mp3') return { kind: 'mp3', bytes };
      // oxlint-disable-next-line typescript/no-non-null-assertion -- PCM metadata was validated before reading the body.
      return { kind: 'pcm', bytes, sampleRate: sampleRate!, channels: channels! };
    };
    try {
      return await Promise.race([operation(), abort]);
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      throw new OpenRouterError('network');
    } finally {
      if (generation !== undefined && pendingCost !== undefined) {
        const { id, key } = generation;
        const finish = pendingCost;
        pendingCost = undefined;
        void Promise.resolve()
          .then(() => this.usage.cost(id, key))
          .then(
            (cost) => {
              try {
                finish(cost);
              } catch {
                /* Cost display cannot affect speech. */
              }
            },
            () => {
              try {
                finish(undefined);
              } catch {
                /* Cost display cannot affect speech. */
              }
            },
          );
      }
      finishCost(undefined);
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (reader !== undefined) void reader.cancel().catch(() => {});
      else if (responseBody !== undefined) void responseBody.cancel().catch(() => {});
      controller.abort();
    }
  }
}
