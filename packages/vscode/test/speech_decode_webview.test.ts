import { afterEach, expect, it, vi } from 'vitest';
import type { SpeechDecodeFromPage } from '@ai-pair/protocol';
import { decodeMp3, decodeSpeech, localSpeechDecoder, type DecodedSamples } from '../src/webview/speech_decode';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('mixes and resamples PCM into the existing mono WAV contract', async () => {
  const pcm = new Uint8Array([255, 127, 0, 0, 0, 0, 255, 127]);
  const result = await decodeSpeech({ format: 'pcm', bytes: pcm, sampleRate: 48_000, channels: 2 }, vi.fn());
  const view = new DataView(result.wav.buffer);
  expect(view.getUint32(24, true)).toBe(24_000);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getInt16(44, true)).toBeGreaterThan(0);
  expect(result.durationMs).toBeGreaterThan(600);
});

it('normalizes decoded MP3 and rejects malformed or silent results', async () => {
  const samples: DecodedSamples = { sampleRate: 24_000, channels: [new Float32Array([0.5, -0.5])] };
  const decoder = vi
    .fn()
    .mockResolvedValueOnce(samples)
    .mockResolvedValueOnce({ ...samples, channels: [new Float32Array(2)] });
  const result = await decodeSpeech({ format: 'mp3', bytes: new Uint8Array([1]) }, decoder);
  expect(new TextDecoder().decode(result.wav.subarray(0, 4))).toBe('RIFF');
  await expect(decodeSpeech({ format: 'mp3', bytes: new Uint8Array([1]) }, decoder)).rejects.toThrow();
});

it('shares a single real codec probe across readiness retries and echoes each identity', async () => {
  let finish: ((value: object) => void) | undefined;
  const decode = vi.fn(
    () =>
      new Promise<object>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = decode;
    },
  );
  const post = vi.fn<(message: SpeechDecodeFromPage) => void>();
  const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
  const document = { pageId: 1, documentGeneration: 1 };
  const receive = localSpeechDecoder(post, token);
  receive({ type: 'speechDecodeChallenge', token, document });
  receive({ type: 'speechDecodeProbe', token, document, probeId: 1 });
  receive({ type: 'speechDecodeProbe', token, document, probeId: 2 });
  expect(decode).toHaveBeenCalledTimes(1);
  finish?.({ sampleRate: 24_000, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1]) });
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({ type: 'speechDecodeReady', token, document, probeId: 2, available: true });
  });
  expect(post).toHaveBeenCalledWith({ type: 'speechDecodeReady', token, document, probeId: 1, available: true });
});

it('converts a local PCM request and returns its document-scoped result', async () => {
  const post = vi.fn<(message: SpeechDecodeFromPage) => void>();
  const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
  const document = { pageId: 1, documentGeneration: 1 };
  const receive = localSpeechDecoder(post, token);
  receive({ type: 'speechDecodeChallenge', token, document });
  receive({
    type: 'speechDecode',
    token,
    document,
    requestId: 1,
    speechId: 1,
    format: 'pcm',
    audioBase64: btoa(String.fromCodePoint(255, 127)),
    sampleRate: 24_000,
    channels: 1,
  });
  await vi.waitFor(() => {
    expect(
      post.mock.calls.some(
        ([value]) =>
          value.type === 'speechDecodeDone' &&
          value.requestId === 1 &&
          value.value !== undefined &&
          value.value.wavBase64.length > 0 &&
          value.value.durationMs > 0,
      ),
    ).toBe(true);
  });
});

it('rejects missing browser audio and invalid PCM before synthesis', async () => {
  vi.stubGlobal('OfflineAudioContext', undefined);
  await expect(decodeMp3(new Uint8Array([1]))).rejects.toThrow();
  for (const input of [
    { format: 'pcm' as const, bytes: new Uint8Array(), sampleRate: 24_000, channels: 1 },
    { format: 'pcm' as const, bytes: new Uint8Array([1]), sampleRate: 24_000, channels: 1 },
    { format: 'pcm' as const, bytes: new Uint8Array([1, 2]), sampleRate: 0, channels: 1 },
    { format: 'pcm' as const, bytes: new Uint8Array([1, 2]), sampleRate: 24_000, channels: 3 },
  ]) {
    await expect(decodeSpeech(input, vi.fn())).rejects.toThrow();
  }
});

it('rejects invalid decoded layouts and non-finite samples', async () => {
  for (const value of [
    { sampleRate: 24_000, channels: [] },
    { sampleRate: 24_000, channels: [new Float32Array(0)] },
    { sampleRate: 1, channels: [new Float32Array([1])] },
    { sampleRate: 24_000, channels: [new Float32Array([1]), new Float32Array(0)] },
    { sampleRate: 24_000, channels: [new Float32Array([Number.NaN])] },
  ]) {
    await expect(decodeSpeech({ format: 'mp3', bytes: new Uint8Array([1]) }, vi.fn().mockResolvedValue(value))).rejects.toThrow();
  }
});

it('rejects malformed, stale and failed messages without accepting another document', async () => {
  vi.stubGlobal('OfflineAudioContext', undefined);
  const post = vi.fn<(message: SpeechDecodeFromPage) => void>();
  const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
  const other = 'a2b2f953-95f5-4fc8-945c-d6b3b9eb54e3';
  const document = { pageId: 1, documentGeneration: 1 };
  const receive = localSpeechDecoder(post, token);
  expect(receive({ type: 'bad' })).toBe(false);
  expect(receive({ type: 'speechDecodeChallenge', token: other, document })).toBe(true);
  expect(receive({ type: 'speechDecodeProbe', token: other, document, probeId: 1 })).toBe(true);
  expect(post).toHaveBeenCalledWith({ type: 'speechDecodeBoot', token });
  expect(receive({ type: 'speechDecodeProbe', token, document, probeId: 1 })).toBe(true);
  receive({ type: 'speechDecodeChallenge', token, document });
  receive({ type: 'speechDecodeProbe', token, document: { ...document, documentGeneration: 2 }, probeId: 1 });
  receive({ type: 'speechDecodeProbe', token, document, probeId: 2 });
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({ type: 'speechDecodeReady', token, document, probeId: 2, available: false });
  });
  receive({ type: 'speechDecodeProbe', token, document, probeId: 3 });
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({ type: 'speechDecodeReady', token, document, probeId: 3, available: false });
  });
  receive({ type: 'speechDecode', token, document, requestId: 1, speechId: 1, format: 'mp3', audioBase64: '!!!' });
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({ type: 'speechDecodeDone', token, document, requestId: 1 });
  });
  receive({ type: 'speechDecode', token, document, requestId: 2, speechId: 1, format: 'pcm', audioBase64: 'AA==' });
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({ type: 'speechDecodeDone', token, document, requestId: 2 });
  });
});

it('returns an MP3 response through the same browser codec and normalized output', async () => {
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData(): Promise<object> {
        return Promise.resolve({ sampleRate: 24_000, numberOfChannels: 1, getChannelData: () => new Float32Array([0.2]) });
      }
    },
  );
  const post = vi.fn<(message: SpeechDecodeFromPage) => void>();
  const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
  const document = { pageId: 1, documentGeneration: 1 };
  const receive = localSpeechDecoder(post, token);
  receive({ type: 'speechDecodeChallenge', token, document });
  receive({ type: 'speechDecode', token, document, requestId: 1, speechId: 1, format: 'mp3', audioBase64: 'AA==' });
  await vi.waitFor(() => {
    expect(
      post.mock.calls.some(
        ([value]) =>
          value.type === 'speechDecodeDone' && value.requestId === 1 && value.value !== undefined && value.value.wavBase64.length > 0,
      ),
    ).toBe(true);
  });
});
