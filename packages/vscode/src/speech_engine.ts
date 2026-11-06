import { env, Tensor } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { phonemize } from '../vendor/kokoro_phonemize.mjs';
import type { SpeechEngine } from './speech_synthesis';

/** Loads the fixed local model and exposes its non-truncating inference path. */
export async function loadSpeechEngine(modelPath: string): Promise<SpeechEngine<Tensor>> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const model = await KokoroTTS.from_pretrained(modelPath, { dtype: 'q8', device: 'cpu' });
  return {
    phonemize,
    tokenize: (phones) => {
      // The pinned tokenizer otherwise silently erases characters outside its vocabulary.
      if (Array.from(phones).some((phone) => phone === '$' || !model.tokenizer.model.tokens_to_ids.has(phone))) {
        throw new Error('The text contains unsupported speech sounds.');
      }
      const encoded: unknown = model.tokenizer(phones, { truncation: false });
      if (typeof encoded !== 'object' || encoded === null || !('input_ids' in encoded) || !(encoded.input_ids instanceof Tensor)) {
        throw new Error('The speech tokenizer returned invalid data.');
      }
      return encoded.input_ids;
    },
    generate: async (tokens, voice, speed) => {
      const audio = await model.generate_from_ids(tokens, { voice, speed });
      return { samples: audio.audio, rate: audio.sampling_rate };
    },
  };
}
