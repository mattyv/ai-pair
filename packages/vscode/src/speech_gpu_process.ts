/** The minimal child lifecycle needed to retire an isolated probe. */
export interface GpuChild {
  /** Registers for the final process event. */
  on: (event: 'close' | 'error', listener: (value?: unknown) => void) => void;
  /** Requests forcible termination. */
  kill: (signal: 'SIGKILL') => boolean;
}

/** Runs a bounded child and waits for exit after timeout before returning. */
export function runGpuProcess(spawn: () => GpuChild, timeoutMs: number): Promise<'passed' | 'failed' | 'timeout'> {
  return new Promise((resolve) => {
    let child: GpuChild;
    try {
      child = spawn();
    } catch {
      resolve('failed');
      return;
    }
    let timedOut = false;
    let failed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Retain ownership until close even if termination fails.
      }
    }, timeoutMs);
    // specs/GpuSetup.tla, Retire: the slot remains owned until the child exits.
    child.on('error', () => {
      failed = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(timedOut ? 'timeout' : !failed && code === 0 ? 'passed' : 'failed');
    });
  });
}
