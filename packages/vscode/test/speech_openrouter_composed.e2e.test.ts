import { expect, it, vi } from 'vitest';
vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));
import { openRouterSpeechRequest } from '@ai-pair/protocol';
import { SpeechCredentials } from '../src/speech_credentials';
import { OpenRouterClient } from '../src/speech_openrouter';
import { OpenRouterCatalog } from '../src/speech_openrouter_catalog';
import { SpeechService } from '../src/speech_service';
import { formatOpenRouterPricing } from '../src/speech_pricing';
import { encodeTempoWav } from '../src/speech_tempo_pcm';
import type { OpenRouterAudioDecoder } from '../src/speech_types';

const model = 'microsoft/mai-voice-2';
const other = 'microsoft/mai-voice-2.1';
const decoder: OpenRouterAudioDecoder = {
  admit: () => {
    const controller = new AbortController();
    return Promise.resolve({
      signal: controller.signal,
      decode: () => Promise.resolve(encodeTempoWav(new Int16Array([1, 2]), false)),
      cancel: () => {
        controller.abort();
      },
    });
  },
};
function catalogResponse(ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id, name: id, supported_voices: ['voice'] })) }), {
    headers: { 'content-type': 'application/json' },
  });
}

it('retains account pricing through catalog publication and formats it for the model selector', async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ id: model, name: 'Speech', supported_voices: [], pricing: { prompt: '0.000015', completion: '0' } }] }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  const client = new OpenRouterClient(() => Promise.resolve('synthetic-key'), fetcher);
  const labels: string[] = [];
  const catalog = new OpenRouterCatalog(client, (view) => {
    if (view.state === 'ready') labels.push(...view.models.map((item) => `${item.name} — ${formatOpenRouterPricing(item.pricing)}`));
  });
  await catalog.load(false);
  expect(labels).toEqual(['Speech — $0.000015 input · $0 output per billing unit']);
});

it('narrows account models by ZDR and plays only the selected authenticated PCM request', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  function fetcher(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url.includes('/models/user')) return Promise.resolve(catalogResponse([model]));
    if (url.includes('/models?')) return Promise.resolve(catalogResponse([model, other]));
    return Promise.resolve(new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  }
  const secrets = new Map<string, string>([['aiPair.openRouter.apiKey', 'synthetic-key']]);
  const credentials = new SpeechCredentials(
    {
      get: (key) => Promise.resolve(secrets.get(key)),
      store: (key, value) => {
        secrets.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        secrets.delete(key);
        return Promise.resolve();
      },
    },
    () => Promise.resolve(undefined),
    () => {},
    'aiPair.openRouter.apiKey',
  );
  const client = new OpenRouterClient(() => credentials.read(), fetcher, decoder);
  const published: string[] = [];
  const catalog = new OpenRouterCatalog(client, (view) => {
    if (view.state === 'ready') published.push(...view.models.map((item) => item.id));
  });
  await catalog.load(true);
  expect(published).toEqual([model]);
  expect(catalog.contains(other, 'voice')).toBe(false);
  expect(calls.slice(0, 2).every((call) => new Headers(call.init?.headers).get('authorization') === 'Bearer synthetic-key')).toBe(true);
  const played = Promise.withResolvers<{ id: number; wav: Uint8Array }>();
  let selectedModel = model;
  const speech = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    openRouter: client,
    openRouterAllowed: (modelId, voiceId) => catalog.allows(modelId, voiceId),
    settings: () => ({
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: selectedModel,
      openRouterVoice: 'voice',
      openRouterZdr: true,
    }),
    output: {
      play: (id, wav) => {
        played.resolve({ id, wav });
        return 1;
      },
      control: () => {},
      status: () => {},
    },
  });
  const pending = speech.speak('Synthetic sample.');
  const audio = await played.promise;
  expect(Buffer.from(audio.wav).toString('ascii', 0, 4)).toBe('RIFF');
  expect(audio.wav.length).toBeLessThan(1_000_000);
  const request = calls.find((call) => call.url.endsWith('/audio/speech'));
  expect(request).toBeDefined();
  if (typeof request?.init?.body !== 'string') throw new Error('Missing JSON body');
  const body: unknown = JSON.parse(request.init.body);
  expect(openRouterSpeechRequest.parse(body)).toEqual({
    model,
    voice: 'voice',
    input: 'Synthetic sample.',
    response_format: 'pcm',
    provider: { zdr: true },
  });
  speech.audioEvent({ id: audio.id, pageId: 1, event: 'ended' });
  await pending;
  selectedModel = other;
  const requestCount = calls.length;
  await speech.speak('Excluded model.');
  expect(calls).toHaveLength(requestCount);
  await speech.dispose();
});

it('does not play a late synthesis response after cancellation', async () => {
  const response = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const client = new OpenRouterClient(
    () => Promise.resolve('synthetic-key'),
    () => {
      started.resolve();
      return response.promise;
    },
    decoder,
  );
  const play = vi.fn(() => 1);
  const speech = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    openRouter: client,
    settings: () => ({
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: model,
      openRouterVoice: 'voice',
      openRouterZdr: false,
    }),
    output: { play, control: () => {}, status: () => {} },
  });
  const pending = speech.speak('Synthetic sample.');
  await started.promise;
  speech.cancel();
  response.resolve(new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  await pending;
  await Promise.resolve();
  expect(play).not.toHaveBeenCalled();
  await speech.dispose();
});

it('does not fetch or play when catalog denial arrives while the secret read is pending', async () => {
  const key = Promise.withResolvers<string | undefined>();
  const secretRead = Promise.withResolvers<void>();
  const fetcher = vi.fn<typeof fetch>();
  const client = new OpenRouterClient(
    () => {
      secretRead.resolve();
      return key.promise;
    },
    fetcher,
    decoder,
  );
  let denied = false;
  const catalog = new OpenRouterCatalog(
    { models: () => Promise.resolve(denied ? [] : [{ id: model, name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }]) },
    () => {},
  );
  const play = vi.fn(() => 1);
  const speech = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    openRouter: client,
    openRouterAllowed: (modelId, voiceId) => catalog.allows(modelId, voiceId),
    settings: () => ({
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: model,
      openRouterVoice: 'voice',
    }),
    output: { play, control: () => {}, status: () => {} },
  });
  const pending = speech.speak('Synthetic sample.');
  await secretRead.promise;
  denied = true;
  await catalog.load(false);
  speech.openRouterCatalogChanged();
  key.resolve('synthetic-key');
  await pending;
  await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  await speech.dispose();
});
