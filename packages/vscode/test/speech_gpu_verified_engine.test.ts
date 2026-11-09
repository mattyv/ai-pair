import { expect, it, vi } from 'vitest';
import { loadVerifiedGpuSpeechEngine } from '../src/speech_gpu_verified_engine';

/** Makes a model that exposes whether it was released. */
function loadedModel() {
  return {
    engine: {
      phonemize: () => Promise.resolve('a'),
      tokenize: () => ({ dims: [1, 3] }),
      generate: () => Promise.resolve({ samples: new Float32Array([1]), rate: 24_000 }),
    },
    dispose: vi.fn(() => Promise.resolve()),
  };
}

it('verifies the loaded process before exposing its engine', async () => {
  const model = loadedModel();
  const load = vi.fn(() => Promise.resolve(model));
  const verify = vi.fn(() => Promise.resolve(true));
  const result = await loadVerifiedGpuSpeechEngine('/model', { path: '/loader', sha256: 'a'.repeat(64) }, { load, verify });
  await result.engine.generate({ dims: [1] }, 'af_heart', 1);
  expect(verify).toHaveBeenCalledTimes(2);
  await result.dispose();
  expect(verify).toHaveBeenCalledWith('/loader', 'a'.repeat(64));
  expect(model.dispose).toHaveBeenCalledOnce();
});

it.each(['false', 'throws'])('disposes the model and fails closed when verification %s', async (result) => {
  const model = loadedModel();
  function verify(): Promise<boolean> {
    return result === 'false' ? Promise.resolve(false) : Promise.reject(new Error('private path'));
  }
  await expect(
    loadVerifiedGpuSpeechEngine('/model', { path: '/loader', sha256: 'a'.repeat(64) }, { load: () => Promise.resolve(model), verify }),
  ).rejects.toThrow('GPU loader verification failed.');
  expect(model.dispose).toHaveBeenCalledOnce();
});

it('rejects generated audio and signals retirement if the mapped loader changes', async () => {
  const model = loadedModel();
  const verify = vi.fn<(path: string, sha256: string) => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const proofFailed = vi.fn<() => void>();
  const loaded = await loadVerifiedGpuSpeechEngine(
    '/model',
    { path: '/loader', sha256: 'a'.repeat(64) },
    { load: () => Promise.resolve(model), verify, proofFailed },
  );
  await expect(loaded.engine.generate({ dims: [1] }, 'af_heart', 1)).rejects.toThrow('GPU loader verification failed.');
  expect(proofFailed).toHaveBeenCalledOnce();
});
