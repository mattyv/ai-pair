import { hasGpuWork } from './speech_gpu_profile';

// These fixed lengths exercise distinct dynamic model shapes.
// eslint-disable-next-line no-magic-numbers
const INPUT_LENGTHS = [4, 8, 16, 21] as const;
const STYLE_SIZE = 256;
const MIN_SAMPLES = 2400;
const MAX_SAMPLES = 720_000;

/** A model session owned by the isolated GPU setup child. */
export interface GpuSelfTestSession {
  run: (feeds: Record<string, unknown>) => Promise<unknown>;
  endProfiling: () => void;
  release: () => Promise<void>;
}

/** Dependencies supplied by the isolated pinned ONNX runtime. */
export interface GpuSelfTestDependencies {
  create: (model: string, profilePrefix: string) => Promise<GpuSelfTestSession>;
  tensor: (type: 'int64' | 'float32', values: BigInt64Array | Float32Array, shape: number[]) => unknown;
  loader: () => Promise<boolean>;
  profile: () => Promise<unknown>;
}

/** Verifies repeated variable-length model inference and profiled WebGPU work. */
export async function runGpuSelfTest(model: string, profilePrefix: string, dependencies: GpuSelfTestDependencies): Promise<boolean> {
  try {
    const session = await dependencies.create(model, profilePrefix);
    try {
      for (const length of INPUT_LENGTHS) {
        if (!(await dependencies.loader())) return false;
        const tokens = new BigInt64Array(length).fill(16n);
        tokens[0] = 0n;
        tokens[length - 1] = 0n;
        const result = await session.run({
          input_ids: dependencies.tensor('int64', tokens, [1, length]),
          style: dependencies.tensor('float32', new Float32Array(STYLE_SIZE), [1, STYLE_SIZE]),
          speed: dependencies.tensor('float32', Float32Array.of(1), [1]),
        });
        if (
          typeof result !== 'object' ||
          result === null ||
          !('waveform' in result) ||
          typeof result.waveform !== 'object' ||
          result.waveform === null ||
          !('data' in result.waveform) ||
          !(result.waveform.data instanceof Float32Array)
        ) {
          return false;
        }
        if (!(await dependencies.loader())) return false;
        const samples = result.waveform.data;
        if (samples.length < MIN_SAMPLES || samples.length > MAX_SAMPLES || samples.some((value) => !Number.isFinite(value))) return false;
      }
      session.endProfiling();
      return hasGpuWork(await dependencies.profile());
    } finally {
      await session.release();
    }
  } catch {
    return false;
  }
}
