// This is the fixed output of the bundled ONNX multiplication graph.
// eslint-disable-next-line no-magic-numbers
const EXPECTED_OUTPUT = [1, 4, 9, 16, 25, 36];

/** A minimal strict-WebGPU session. */
export interface GpuTinySession {
  run: (feeds: Record<string, unknown>) => Promise<unknown>;
  release: () => Promise<void>;
}
/** Operations provided by the isolated pinned runtime. */
export interface GpuTinyDependencies {
  create: (graph: string) => Promise<GpuTinySession>;
  tensor: () => unknown;
  loader: () => Promise<boolean>;
}

/** Executes the tiny fixed graph and requires the verified loader throughout. */
export async function runGpuTiny(graph: string, dependencies: GpuTinyDependencies): Promise<boolean> {
  try {
    const session = await dependencies.create(graph);
    try {
      if (!(await dependencies.loader())) return false;
      const result = await session.run({ X: dependencies.tensor() });
      if (
        typeof result !== 'object' ||
        result === null ||
        !('Y' in result) ||
        typeof result.Y !== 'object' ||
        result.Y === null ||
        !('data' in result.Y) ||
        !(result.Y.data instanceof Float32Array)
      ) {
        return false;
      }
      if (result.Y.data.length !== EXPECTED_OUTPUT.length || result.Y.data.some((value, index) => value !== EXPECTED_OUTPUT[index])) {
        return false;
      }
      return await dependencies.loader();
    } finally {
      await session.release();
    }
  } catch {
    return false;
  }
}
