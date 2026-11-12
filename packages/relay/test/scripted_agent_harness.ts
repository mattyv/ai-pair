/** Bounds a script operation and reports the reproducible seed and event trace on a stall. */
export async function deadline<T>(operation: Promise<T>, ms: number, seed: number, trace: string[]): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((resolve, reject) => {
        void resolve;
        timer = setTimeout(() => {
          reject(new Error(`seed ${seed}: timed out after ${ms}ms; trace: ${trace.join(' -> ')}`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
