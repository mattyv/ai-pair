import { expect, it, vi } from 'vitest';
import { SpeechDecodeBridge, type DecodeMessage } from '../src/speech_decode_bridge';
import { OpenRouterClient } from '../src/speech_openrouter';
import { SpeechOutputRouter } from '../src/speech_output_router';
import { SpeechService, type SpeechAudioEvent } from '../src/speech_service';
import { encodeTempoWav } from '../src/speech_tempo_pcm';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

function fixture() {
  const messages: DecodeMessage[] = [];
  const bridge = new SpeechDecodeBridge({
    post: (message) => {
      messages.push(message);
      return Promise.resolve(true);
    },
    page: () => 1,
    probeTimeoutMs: 500,
    decodeTimeoutMs: 500,
  });
  const document = bridge.prepare(1);
  bridge.activate(document);
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(new Uint8Array([1, 0]), { headers: { 'content-type': 'audio/pcm' } })),
  );
  const client = new OpenRouterClient(() => Promise.resolve('test-key'), fetcher, bridge);
  const played = Promise.withResolvers<{ name: string; wav: Uint8Array }>();
  let audioEvent: ((kind: SpeechAudioEvent['event']) => void) | undefined;
  const driver = {
    available: () => true,
    play: (name: string, wav: Uint8Array, event: (kind: SpeechAudioEvent['event']) => void) => {
      audioEvent = event;
      played.resolve({ name, wav });
      return true;
    },
    control: vi.fn(),
  };
  const choice = { kind: 'native', backend: 'coreaudio', name: 'test-output' } as const;
  let service: SpeechService;
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice, label: 'Test output', available: true }] }),
    choice: () => choice,
    defaultOutput: { play: () => undefined, control: () => {}, status: () => {} },
    currentPage: () => 1,
    audioEvent: (event) => {
      service.audioEvent(event);
    },
  });
  service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output: router,
    openRouter: client,
    settings: () => ({
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'microsoft/mai-voice-2',
      openRouterVoice: '',
      openRouterFormat: 'pcm',
    }),
  });
  return {
    bridge,
    document,
    service,
    fetcher,
    messages,
    played,
    end: () => {
      audioEvent?.('ended');
    },
  };
}

it('delivers normalized decoder WAV to the selected native output', async () => {
  const context = fixture();
  const pending = context.service.speak('Sample.');
  await vi.waitFor(() => {
    expect(context.messages.some((message) => message.type === 'speechDecodeProbe')).toBe(true);
  });
  const probe = context.messages.find((message) => message.type === 'speechDecodeProbe');
  if (probe?.type !== 'speechDecodeProbe') throw new Error('Missing readiness probe');
  expect(context.fetcher).not.toHaveBeenCalled();
  context.bridge.ready(context.document, probe.probeId, true);
  await vi.waitFor(() => {
    expect(context.messages.some((message) => message.type === 'speechDecode')).toBe(true);
  });
  const decode = context.messages.find((message) => message.type === 'speechDecode');
  if (decode?.type !== 'speechDecode') throw new Error('Missing decode request');
  const normalized = encodeTempoWav(new Int16Array([1, 2]), false);
  context.bridge.decoded(context.document, decode.requestId, {
    wavBase64: Buffer.from(normalized.wav).toString('base64'),
    durationMs: normalized.durationMs,
  });
  const played = await context.played.promise;
  expect(played.name).toBe('test-output');
  expect(played.wav).toEqual(normalized.wav);
  context.end();
  await pending;
  await context.service.dispose();
  context.bridge.destroy(context.document);
});

it('does not play a decode result delivered after service shutdown', async () => {
  const context = fixture();
  const pending = context.service.speak('Sample.');
  await vi.waitFor(() => {
    expect(context.messages.some((message) => message.type === 'speechDecodeProbe')).toBe(true);
  });
  const probe = context.messages.find((message) => message.type === 'speechDecodeProbe');
  if (probe?.type !== 'speechDecodeProbe') throw new Error('Missing readiness probe');
  context.bridge.ready(context.document, probe.probeId, true);
  await vi.waitFor(() => {
    expect(context.messages.some((message) => message.type === 'speechDecode')).toBe(true);
  });
  const decode = context.messages.find((message) => message.type === 'speechDecode');
  if (decode?.type !== 'speechDecode') throw new Error('Missing decode request');
  await context.service.dispose();
  await pending;
  await expect(context.bridge.admit(99, new AbortController().signal)).rejects.toThrow();
  const normalized = encodeTempoWav(new Int16Array([1, 2]), false);
  context.bridge.decoded(context.document, decode.requestId, {
    wavBase64: Buffer.from(normalized.wav).toString('base64'),
    durationMs: normalized.durationMs,
  });
  const afterRetirement = await context.bridge.admit(99, new AbortController().signal);
  afterRetirement.cancel();
  let played = false;
  void context.played.promise.then(() => {
    played = true;
  });
  await Promise.resolve();
  expect(played).toBe(false);
  context.bridge.destroy(context.document);
});
