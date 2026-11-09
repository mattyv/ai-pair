import type { DisposableGpuEngine } from './speech_gpu_worker_host';
import type { SpeechTokens } from './speech_synthesis';

/** Loads a model and verifies the loader actually mapped in the same child. */
export async function loadVerifiedGpuSpeechEngine<T extends SpeechTokens>(
  modelPath: string,
  loader: { path: string; sha256: string },
  dependencies: {
    load(path: string): Promise<DisposableGpuEngine<T>>;
    verify(path: string, sha256: string): Promise<boolean>;
    proofFailed?(): void;
  },
): Promise<DisposableGpuEngine<T>> {
  const model = await dependencies.load(modelPath);
  async function verified(): Promise<boolean> {
    try {
      return await dependencies.verify(loader.path, loader.sha256);
    } catch {
      return false;
    }
  }
  if (!(await verified())) {
    try {
      await model.dispose();
    } catch {
      /* The child is retired on load failure. */
    }
    throw new Error('GPU loader verification failed.');
  }
  return {
    engine: {
      ...model.engine,
      generate: async (tokens, voice, speed) => {
        const audio = await model.engine.generate(tokens, voice, speed);
        if (!(await verified())) {
          dependencies.proofFailed?.();
          throw new Error('GPU loader verification failed.');
        }
        return audio;
      },
    },
    dispose: () => model.dispose(),
  };
}
