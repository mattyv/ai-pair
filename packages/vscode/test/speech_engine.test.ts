import { expect, it, vi } from 'vitest';
import { env, type PreTrainedTokenizer } from '@huggingface/transformers';
import { mock } from 'vitest-mock-extended';
import type { KokoroTTS } from 'kokoro-js';
import { phonemize } from '../vendor/kokoro_phonemize.mjs';
import { loadSpeechEngine } from '../src/speech_engine';

const fake = vi.hoisted(() => ({
  Tensor: class {
    dims = [1, 3];
  },
  load: vi.fn(),
  tokenize: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@huggingface/transformers', () => ({ env: { allowRemoteModels: true, allowLocalModels: false }, Tensor: fake.Tensor }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: fake.load } }));
vi.mock('../vendor/kokoro_phonemize.mjs', () => ({ phonemize: vi.fn() }));

it('loads local CPU assets and forwards the same untruncated tokens to the model', async () => {
  const idsFromTokenizer = new fake.Tensor();
  fake.tokenize.mockReturnValue({ input_ids: idsFromTokenizer });
  fake.generate.mockResolvedValue({ audio: new Float32Array([0.5]), sampling_rate: 24_000 });
  const model: KokoroTTS = mock<KokoroTTS>();
  model.tokenizer = Object.assign(fake.tokenize, mock<PreTrainedTokenizer>(), {
    model: { tokens_to_ids: new Map(Array.from('phonemes').map((letter) => [letter, 1])) },
  });
  model.generate_from_ids = fake.generate;
  fake.load.mockResolvedValue(model);
  vi.mocked(phonemize).mockResolvedValue('phonemes');
  const engine = await loadSpeechEngine('/local/model');
  expect(env.allowRemoteModels).toBe(false);
  expect(env.allowLocalModels).toBe(true);
  expect(fake.load).toHaveBeenCalledWith('/local/model', { dtype: 'q8', device: 'cpu' });
  expect(await engine.phonemize('Hello.', 'a')).toBe('phonemes');
  const ids = engine.tokenize('phonemes');
  expect(fake.tokenize).toHaveBeenCalledWith('phonemes', { truncation: false });
  expect(() => engine.tokenize('phonemes\u2603')).toThrow('unsupported');
  expect(() => engine.tokenize('$')).toThrow('unsupported');
  expect(fake.tokenize).toHaveBeenCalledTimes(1);
  expect(await engine.generate(ids, 'af_heart', 1)).toEqual({ samples: new Float32Array([0.5]), rate: 24_000 });
  expect(fake.generate).toHaveBeenCalledWith(idsFromTokenizer, { voice: 'af_heart', speed: 1 });
  fake.tokenize.mockReturnValueOnce({ input_ids: 'invalid' });
  expect(() => engine.tokenize('phonemes')).toThrow('invalid data');
});
