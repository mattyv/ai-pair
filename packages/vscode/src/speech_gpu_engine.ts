import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { phonemize } from '../vendor/kokoro_phonemize.mjs';
import type { DisposableGpuEngine } from './speech_gpu_worker_host';
import { gpuSessionOptions } from './speech_gpu_options';

/** Checks the Transformers 4 vocabulary interface before using it. */
function hasVocabulary(value: unknown): value is { get_vocab(): unknown } {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    'get_vocab' in value &&
    typeof value.get_vocab === 'function'
  );
}

/** Loads the verified FP32 model offline in the isolated WebGPU runtime. */
export async function loadGpuSpeechEngine(modelPath: string): Promise<DisposableGpuEngine<Tensor>> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const [base, loadedTokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelPath, { dtype: 'fp32', device: 'webgpu', session_options: gpuSessionOptions(false) }),
    AutoTokenizer.from_pretrained(modelPath),
  ]);
  const model = new KokoroTTS(base, loadedTokenizer);
  return {
    engine: {
      phonemize,
      tokenize: (phones) => {
        const tokenizer: unknown = model.tokenizer;
        if (!hasVocabulary(tokenizer)) throw new Error('The speech vocabulary is unavailable.');
        const vocabulary = tokenizer.get_vocab();
        if (!(vocabulary instanceof Map)) throw new Error('The speech vocabulary is unavailable.');
        if (Array.from(phones).some((phone) => phone === '$' || !vocabulary.has(phone))) {
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
    },
    dispose: async () => {
      await model.model.dispose();
    },
  };
}
