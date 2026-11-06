import { env, type Tensor } from '@huggingface/transformers';
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
    tokenize: (phones) => model.tokenizer(phones, { truncation: false }).input_ids,
    generate: async (tokens, voice, speed) => {
      const audio = await model.generate_from_ids(tokens, { voice, speed });
      return { samples: audio.audio, rate: audio.sampling_rate };
    },
  };
}
