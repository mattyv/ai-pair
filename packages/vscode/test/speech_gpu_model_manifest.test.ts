import { expect, it } from 'vitest';
import { GPU_MODEL_ASSET } from '../src/speech_gpu_model_manifest';

it('pins the additional FP32 model to its reviewed size and digest', () => {
  expect(GPU_MODEL_ASSET).toEqual({
    path: 'onnx/model.onnx',
    size: 325_532_232,
    sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
  });
});
