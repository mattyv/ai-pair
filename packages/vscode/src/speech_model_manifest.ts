/** Exact upstream model revision. */
export const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';

/** Fixed upstream model location; no narration is sent during setup. */
export const MODEL_URL = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${MODEL_REVISION}`;

/** Executable cached only after an explicit, verified setup. */
export const PHONEMIZER_ASSET = {
  path: 'runtime/phonemizer-1.2.1.mjs',
  size: 1_322_380,
  sha256: '193481f474f7c1ea81df3195d18b45df8ef7254dbdccb3f193d60215c4897bec',
  url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js',
} as const;

/** Files and SHA-256 digests checked before model installation or use. */
export const MODEL_ASSETS = [
  { path: 'config.json', size: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', size: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', size: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { path: 'onnx/model_quantized.onnx', size: 92_361_116, sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478' },
  PHONEMIZER_ASSET,
  {
    path: 'runtime/phonemizer-1.2.1-LICENSE.txt',
    size: 11_357,
    sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
    url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE',
  },
] as const;
