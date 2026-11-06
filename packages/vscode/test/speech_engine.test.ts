import { expect, it, vi } from 'vitest';
import { env, type PreTrainedTokenizer } from '@huggingface/transformers';
import { mock } from 'vitest-mock-extended';
import { KokoroTTS } from 'kokoro-js';
import { phonemize } from '../vendor/kokoro_phonemize.mjs';
import { loadSpeechEngine } from '../src/speech_engine';

const fake = vi.hoisted(() => ({
  ids: { dims: [1, 3] },
  tokenize: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@huggingface/transformers', () => ({ env: { allowRemoteModels: true, allowLocalModels: false } }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() } }));
vi.mock('../vendor/kokoro_phonemize.mjs', () => ({ phonemize: vi.fn() }));

it('loads local CPU assets and forwards the same untruncated tokens to the model', async () => {
  fake.tokenize.mockReturnValue({ input_ids: fake.ids });
  fake.generate.mockResolvedValue({ audio: new Float32Array([0.5]), sampling_rate: 24000 });
  const model: KokoroTTS = mock<KokoroTTS>();
  model.tokenizer = Object.assign(fake.tokenize, mock<PreTrainedTokenizer>());
  model.generate_from_ids = fake.generate;
  vi.mocked(KokoroTTS.from_pretrained).mockResolvedValue(model);
  vi.mocked(phonemize).mockResolvedValue('phonemes');
  const engine = await loadSpeechEngine('/local/model');
  expect(env.allowRemoteModels).toBe(false);
  expect(env.allowLocalModels).toBe(true);
  expect(KokoroTTS.from_pretrained).toHaveBeenCalledWith('/local/model', { dtype: 'q8', device: 'cpu' });
  expect(await engine.phonemize('Hello.', 'a')).toBe('phonemes');
  const ids = engine.tokenize('phonemes');
  expect(fake.tokenize).toHaveBeenCalledWith('phonemes', { truncation: false });
  expect(await engine.generate(ids, 'af_heart', 1)).toEqual({ samples: new Float32Array([0.5]), rate: 24000 });
  expect(fake.generate).toHaveBeenCalledWith(fake.ids, { voice: 'af_heart', speed: 1 });
});
