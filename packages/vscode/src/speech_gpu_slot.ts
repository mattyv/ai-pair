let occupied = false;

/** Reports that a prior GPU child must finish before retrying. */
export class GpuProcessBusyError extends Error {
  constructor() {
    super('GPU speech is still finishing; try again shortly.');
    this.name = 'GpuProcessBusyError';
  }
}

/** Acquires a process lease immediately, or fails while another child owns it. */
export function tryAcquireGpuProcessSlot(): (() => void) | undefined {
  if (occupied) return undefined;
  occupied = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    occupied = false;
  };
}

/** Runs a child operation or immediately reports busy without disturbing its owner. */
export function withGpuProcessSlot<T>(operation: () => Promise<T>): Promise<T> {
  const release = tryAcquireGpuProcessSlot();
  if (release === undefined) return Promise.reject(new GpuProcessBusyError());
  return Promise.resolve().then(operation).finally(release);
}
