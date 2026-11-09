import { beforeEach, expect, it, vi } from 'vitest';
import { loadGpuSpeechEngine } from '../src/speech_gpu_engine';

const fake = vi.hoisted(() => {
  class Tensor {
    dims = [1, 3];
  }
  const model = {
    tokenizer: Object.assign(
      vi.fn<() => { input_ids: unknown }>(() => ({ input_ids: new Tensor() })),
      { get_vocab: () => new Map([['a', 1]]) },
    ),
    generate_from_ids: vi.fn(() => Promise.resolve({ audio: new Float32Array([0.5]), sampling_rate: 24_000 })),
    model: { dispose: vi.fn(() => Promise.resolve()) },
  };
  return {
    Tensor,
    model,
    fromPretrained: vi.fn(() => Promise.resolve(model.model)),
    tokenizer: vi.fn(() => Promise.resolve(model.tokenizer)),
    env: { allowRemoteModels: true, allowLocalModels: false },
    phonemize: vi.fn(),
    options: vi.fn(() => ({ executionProviders: ['webgpu'], extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } } } })),
  };
});
vi.mock('../src/speech_gpu_options', () => ({ gpuSessionOptions: fake.options }));
vi.mock('@huggingface/transformers', () => ({
  Tensor: fake.Tensor,
  env: fake.env,
  StyleTextToSpeech2Model: { from_pretrained: fake.fromPretrained },
  AutoTokenizer: { from_pretrained: fake.tokenizer },
}));
vi.mock('kokoro-js', () => ({
  // The production collaborator is constructed with `new`.
  // oxlint-disable-next-line typescript/no-extraneous-class
  KokoroTTS: class {
    constructor() {
      return fake.model;
    }
  },
}));
vi.mock('../vendor/kokoro_phonemize.mjs', () => ({ phonemize: fake.phonemize }));
beforeEach(() => {
  vi.clearAllMocks();
});

it('loads the FP32 model offline on WebGPU and releases it on disposal', async () => {
  const loaded = await loadGpuSpeechEngine('/verified/model');
  expect(fake.env.allowRemoteModels).toBe(false);
  expect(fake.env.allowLocalModels).toBe(true);
  expect(fake.fromPretrained).toHaveBeenCalledWith('/verified/model', {
    dtype: 'fp32',
    device: 'webgpu',
    session_options: { executionProviders: ['webgpu'], extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } } } },
  });
  expect(fake.tokenizer).toHaveBeenCalledWith('/verified/model');
  const tokens = loaded.engine.tokenize('a');
  expect(await loaded.engine.generate(tokens, 'af_heart', 1)).toEqual({ samples: new Float32Array([0.5]), rate: 24_000 });
  await loaded.dispose();
  expect(fake.model.model.dispose).toHaveBeenCalledOnce();
});

it('rejects unsupported phonemes and malformed tokenizer output', async () => {
  const loaded = await loadGpuSpeechEngine('/verified/model');
  expect(() => loaded.engine.tokenize('$')).toThrow();
  expect(() => loaded.engine.tokenize('z')).toThrow();
  fake.model.tokenizer.mockReturnValueOnce({ input_ids: undefined });
  expect(() => loaded.engine.tokenize('a')).toThrow();
});

it('fails closed when the GPU tokenizer exposes no valid vocabulary', async () => {
  const loaded = await loadGpuSpeechEngine('/verified/model');
  const original = fake.model.tokenizer.get_vocab;
  try {
    Reflect.set(fake.model.tokenizer, 'get_vocab', undefined);
    expect(() => {
      loaded.engine.tokenize('a');
    }).toThrow('vocabulary');
    Reflect.set(fake.model.tokenizer, 'get_vocab', () => 'invalid');
    expect(() => {
      loaded.engine.tokenize('a');
    }).toThrow('vocabulary');
  } finally {
    Reflect.set(fake.model.tokenizer, 'get_vocab', original);
  }
});

it('rejects malformed tokenizer objects without trusting their vocabulary', async () => {
  const loaded = await loadGpuSpeechEngine('/verified/model');
  const original = fake.model.tokenizer;
  try {
    // Exercise a malformed external library value, which can be null.
    // oxlint-disable-next-line unicorn/no-null
    Reflect.set(fake.model, 'tokenizer', null);
    expect(() => {
      loaded.engine.tokenize('a');
    }).toThrow('vocabulary');
    Reflect.set(fake.model, 'tokenizer', { get_vocab: () => new Map([['a', 1]]) });
    expect(() => {
      loaded.engine.tokenize('a');
    }).toThrow();
  } finally {
    Reflect.set(fake.model, 'tokenizer', original);
  }
});
