import { expect, it } from 'vitest';
import { TEMPO_REQUEST, TEMPO_RESPONSE } from '../src/speech_tempo_messages';
import { TEMPO_REQUEST as FAKE_REQUEST, TEMPO_RESPONSE as FAKE_RESPONSE } from './fixtures/tempo_schema_fake';

it('accepts bounded owned PCM with immutable worker, unit, part and rate identity', () => {
  const request = { type: 'transform', epoch: 1, unitId: 2, part: 1, rate: 0.75, pcm: Int16Array.from([1, -1]) };
  expect(TEMPO_REQUEST.safeParse(request).success).toBe(true);
  expect(TEMPO_RESPONSE.safeParse({ ...request, type: 'result' }).success).toBe(true);
  expect(FAKE_REQUEST.safeParse(request).success).toBe(true);
  expect(FAKE_RESPONSE.safeParse({ ...request, type: 'result' }).success).toBe(true);
  for (const invalid of [
    { ...request, epoch: 0 },
    { ...request, part: 4 },
    { ...request, rate: 0.9 },
    { ...request, pcm: new Int16Array() },
    { ...request, pcm: new Int16Array(960_001) },
    { ...request, secret: 'private' },
  ]) {
    expect(TEMPO_REQUEST.safeParse(invalid).success).toBe(false);
    expect(FAKE_REQUEST.safeParse(invalid).success).toBe(false);
  }
});
