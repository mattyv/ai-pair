import { pcmToSpeech } from './speech_pcm';
import {
  ELEVENLABS_SPEEDS,
  type ElevenLabsSpeechPort,
  type ElevenLabsVoice,
  type ElevenLabsVoicePage,
  type SpeechAudioResult,
} from './speech_types';

const ORIGIN = 'https://api.elevenlabs.io';
const SYNTHESIS_TIMEOUT_MS = 20_000;
const CATALOG_TIMEOUT_MS = 10_000;
const MAX_PCM_BYTES = 1_920_000;
const MAX_CATALOG_BYTES = 1_048_576;
const MAX_VOICES = 500;
const MAX_CURSOR = 512;
const MAX_NAME = 160;
const MAX_CATEGORY = 64;
// HTTP status values are protocol-defined.
// oxlint-disable-next-line eslint/no-magic-numbers
const AUTH_STATUSES = new Set([401, 403, 404]);
// oxlint-disable-next-line eslint/no-magic-numbers
const RATE_LIMIT_STATUS = 429;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Safe categories suitable for mapping to fixed interface messages. */
export type ElevenLabsErrorKind = 'key' | 'auth' | 'rate' | 'network' | 'timeout' | 'invalid' | 'canceled';
/** Never contains a provider response, secret, request text, or URL. */
export class ElevenLabsError extends Error {
  constructor(readonly kind: ElevenLabsErrorKind) {
    super(`ElevenLabs request failed: ${kind}.`);
  }
}

/** The fixed endpoint and bounded response reader for one account. */
export class ElevenLabsClient implements ElevenLabsSpeechPort {
  constructor(
    private readonly readKey: () => Promise<string | undefined>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async synthesize(request: { text: string; voiceId: string; speed: number }, signal: AbortSignal): Promise<SpeechAudioResult> {
    if (!ID.test(request.voiceId) || !ELEVENLABS_SPEEDS.some((speed) => speed === request.speed) || request.text.length === 0) {
      throw new ElevenLabsError('invalid');
    }
    const url = `${ORIGIN}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}?output_format=pcm_24000`;
    const bytes = await this.request(
      url,
      'POST',
      {
        text: request.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { speed: request.speed },
      },
      signal,
      SYNTHESIS_TIMEOUT_MS,
      MAX_PCM_BYTES,
      'audio',
    );
    try {
      return pcmToSpeech(bytes);
    } catch {
      throw new ElevenLabsError('invalid');
    }
  }

  async voices(cursor: string | undefined, signal: AbortSignal): Promise<ElevenLabsVoicePage> {
    if (cursor !== undefined && (cursor.length === 0 || cursor.length > MAX_CURSOR)) throw new ElevenLabsError('invalid');
    const url = new URL('/v2/voices', ORIGIN);
    url.searchParams.set('page_size', '100');
    url.searchParams.set('include_total_count', 'false');
    url.searchParams.set('sort', 'name');
    if (cursor !== undefined) url.searchParams.set('next_page_token', cursor);
    const bytes = await this.request(url.toString(), 'GET', undefined, signal, CATALOG_TIMEOUT_MS, MAX_CATALOG_BYTES, 'json');
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (
        typeof value !== 'object' ||
        value === null ||
        !('voices' in value) ||
        !Array.isArray(value.voices) ||
        value.voices.length > MAX_VOICES ||
        !('has_more' in value) ||
        typeof value.has_more !== 'boolean'
      ) {
        throw new ElevenLabsError('invalid');
      }
      const voices: ElevenLabsVoice[] = value.voices.map((item: unknown) => {
        if (
          typeof item !== 'object' ||
          item === null ||
          !('voice_id' in item) ||
          typeof item.voice_id !== 'string' ||
          !ID.test(item.voice_id) ||
          !('name' in item) ||
          typeof item.name !== 'string' ||
          item.name.length === 0 ||
          item.name.length > MAX_NAME
        ) {
          throw new ElevenLabsError('invalid');
        }
        const result: ElevenLabsVoice = { id: item.voice_id, name: item.name };
        if ('category' in item && item.category !== null && item.category !== undefined) {
          if (typeof item.category !== 'string' || item.category.length > MAX_CATEGORY) throw new ElevenLabsError('invalid');
          result.category = item.category;
        }
        return result;
      });
      if (!value.has_more) return { voices };
      if (
        !('next_page_token' in value) ||
        typeof value.next_page_token !== 'string' ||
        value.next_page_token.length === 0 ||
        value.next_page_token.length > MAX_CURSOR ||
        value.next_page_token === cursor
      ) {
        throw new ElevenLabsError('invalid');
      }
      return { voices, nextCursor: value.next_page_token };
    } catch {
      throw new ElevenLabsError('invalid');
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
        reject(new ElevenLabsError(timedOut ? 'timeout' : 'canceled'));
      }
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    const operation = async (): Promise<Uint8Array> => {
      const key = await this.readKey();
      if (controller.signal.aborted) throw new ElevenLabsError(timedOut ? 'timeout' : 'canceled');
      if (key === undefined || key.length === 0) throw new ElevenLabsError('key');
      const headers: Record<string, string> = { 'xi-api-key': key };
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
        throw new ElevenLabsError(timedOut ? 'timeout' : 'canceled');
      }
      if (!response.ok) {
        if (AUTH_STATUSES.has(response.status)) throw new ElevenLabsError('auth');
        if (response.status === RATE_LIMIT_STATUS) throw new ElevenLabsError('rate');
        throw new ElevenLabsError('network');
      }
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (kind === 'json' ? type !== 'application/json' : type !== 'audio/pcm' && type !== 'application/octet-stream') {
        throw new ElevenLabsError('invalid');
      }
      if (response.body === null) throw new ElevenLabsError('invalid');
      reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) throw new ElevenLabsError('invalid');
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
      if (error instanceof ElevenLabsError) throw error;
      throw new ElevenLabsError('network');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (reader !== undefined) void reader.cancel().catch(() => {});
      else if (responseBody !== undefined) void responseBody.cancel().catch(() => {});
      controller.abort();
    }
  }
}
