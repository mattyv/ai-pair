import { expect, it } from 'vitest';
import { speechDecodeFromPage, speechDecodeToPage } from '../src/speech_decode';

const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
const document = { pageId: 1, documentGeneration: 1 };

it('accepts locally scoped browser messages and rejects malformed identities', () => {
  for (const message of [
    { type: 'speechDecodeBoot', token },
    { type: 'speechDecodeBootAck', token, document },
    { type: 'speechDecodeReady', token, document, probeId: 1, available: true },
    { type: 'speechDecodeDone', token, document, requestId: 1, value: { wavBase64: 'AA==', durationMs: 600 } },
    { type: 'speechDecodeDone', token, document, requestId: 1 },
  ]) {
    expect(speechDecodeFromPage.safeParse(message).success).toBe(true);
  }
  expect(speechDecodeFromPage.safeParse({ type: 'speechDecodeBoot', token: 'bad' }).success).toBe(false);
  expect(
    speechDecodeFromPage.safeParse({ type: 'speechDecodeReady', token, document: { ...document, pageId: 0 }, probeId: 1, available: true })
      .success,
  ).toBe(false);
  expect(
    speechDecodeFromPage.safeParse({
      type: 'speechDecodeDone',
      token,
      document,
      requestId: 1,
      value: { wavBase64: 'A'.repeat(2_598_461), durationMs: 600 },
    }).success,
  ).toBe(false);
});

it('accepts local host messages and rejects oversized audio and malformed identity', () => {
  for (const message of [
    { type: 'speechDecodeChallenge', token, document },
    { type: 'speechDecodeProbe', token, document, probeId: 1 },
    { type: 'speechDecode', token, document, requestId: 1, speechId: 1, format: 'mp3', audioBase64: 'AA==' },
    {
      type: 'speechDecode',
      token,
      document,
      requestId: 1,
      speechId: 1,
      format: 'pcm',
      audioBase64: 'AA==',
      sampleRate: 24_000,
      channels: 1,
    },
  ]) {
    expect(speechDecodeToPage.safeParse(message).success).toBe(true);
  }
  expect(speechDecodeToPage.safeParse({ type: 'speechDecodeProbe', token, document, probeId: -1 }).success).toBe(false);
  expect(
    speechDecodeToPage.safeParse({
      type: 'speechDecode',
      token,
      document,
      requestId: 1,
      speechId: 1,
      format: 'mp3',
      audioBase64: 'A'.repeat(20_480_001),
    }).success,
  ).toBe(false);
});
