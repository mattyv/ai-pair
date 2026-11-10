/** The minimal child lifecycle needed to retire an isolated probe. */
export interface GpuChild {
  /** Registers for the final process event. */
  on: (event: 'close' | 'error', listener: (value?: unknown) => void) => void;
  /** Requests forcible termination. */
  kill: (signal: 'SIGKILL') => boolean;
}

/** Runs a bounded child and waits for exit after timeout before returning. */
export function runGpuProcess(spawn: () => GpuChild, timeoutMs: number, signal?: AbortSignal): Promise<'passed' | 'failed' | 'timeout'> {
  function aborted(): boolean {
    return signal?.aborted === true;
  }
  return new Promise((resolve, reject) => {
    if (aborted()) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let child: GpuChild;
    try {
      child = spawn();
    } catch {
      if (aborted()) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      resolve('failed');
      return;
    }
    let timedOut = false;
    let failed = false;
    // specs/GpuProofAbort.tla, Abort: request termination without releasing ownership.
    function abort(): void {
      try {
        child.kill('SIGKILL');
      } catch {
        /* Wait for close. */
      }
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (aborted()) abort();
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
    // specs/GpuProofAbort.tla, Close: only close permits settlement.
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (aborted()) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      resolve(timedOut ? 'timeout' : !failed && code === 0 ? 'passed' : 'failed');
    });
  });
}
