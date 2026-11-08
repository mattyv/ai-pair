import { expect, it, vi } from 'vitest';
import { stretchSpeechPcm } from '../src/speech_tempo';
import { TEMPO_REQUEST, TEMPO_RESPONSE } from '../src/speech_tempo_messages';
import { runTempoRequest } from '../src/speech_tempo_worker_host';

vi.mock('../src/speech_tempo_messages', () => import('./fixtures/tempo_schema_fake'));
vi.mock('../src/speech_tempo', () => ({
  SPEECH_LISTENING_RATES: [0.75, 1, 1.25, 1.5],
  stretchSpeechPcm: vi.fn(),
}));

it('returns schema-checked transformed samples with their exact owner', () => {
  const input = TEMPO_REQUEST.parse({ type: 'transform', epoch: 1, unitId: 2, part: 1, rate: 0.75, pcm: Int16Array.from([1, 2]) });
  vi.mocked(stretchSpeechPcm).mockReturnValueOnce(Int16Array.from([3, 4, 5]));
  expect(TEMPO_RESPONSE.parse(runTempoRequest(input))).toEqual({ ...input, type: 'result', pcm: Int16Array.from([3, 4, 5]) });
});

it('returns only a fixed error for failed processing and rejects malformed input', () => {
  const request = TEMPO_REQUEST.parse({ type: 'transform', epoch: 1, unitId: 2, part: 0, rate: 1.5, pcm: Int16Array.from([1]) });
  vi.mocked(stretchSpeechPcm).mockImplementationOnce(() => {
    throw new Error('private audio');
  });
  expect(TEMPO_RESPONSE.parse(runTempoRequest(request))).toEqual({
    type: 'failed',
    epoch: 1,
    unitId: 2,
    part: 0,
    rate: 1.5,
    reason: 'failed',
  });
  expect(runTempoRequest({ type: 'bad' })).toBeUndefined();
});
