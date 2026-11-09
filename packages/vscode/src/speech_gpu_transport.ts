import type { WorkerLike } from './speech_local_client';

/** The bounded process operations used by the synthesis transport. */
export interface GpuChildProcess {
  send(message: unknown, callback: (error: Error | null) => void): void;
  kill(signal: 'SIGKILL'): boolean;
  on(event: 'message' | 'error' | 'close', listener: (value: unknown) => void): void;
}

/** Time allowed for model disposal before forcibly terminating the child. */
const SHUTDOWN_GRACE_MS = 2000;

/** Adapts a child process to the warm-worker protocol and retains it until close. */
export class GpuProcessTransport implements WorkerLike {
  private readonly listeners = new Map<'message' | 'error' | 'exit', (value: unknown) => void>();
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly completion = Promise.withResolvers<void>();

  constructor(private readonly child: GpuChildProcess) {
    child.on('message', (value) => {
      this.listeners.get('message')?.(value);
    });
    child.on('error', (value) => {
      this.listeners.get('error')?.(value);
    });
    child.on('close', (value) => {
      if (this.closed) return;
      this.closed = true;
      clearTimeout(this.timer);
      this.listeners.get('exit')?.(value);
      this.completion.resolve();
    });
  }

  /** Sends a protocol message; asynchronous IPC errors retire the owning client. */
  postMessage(message: unknown): void {
    if (this.closed) throw new Error('GPU worker is closed.');
    this.child.send(message, (error) => {
      if (error !== null) this.listeners.get('error')?.(error);
    });
  }

  /** Registers a worker-compatible event handler. */
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): void {
    this.listeners.set(event, listener);
  }

  /** Allows disposal briefly, then kills; completion waits for the close event. */
  terminate(): Promise<void> {
    if (!this.closed && this.timer === undefined) {
      this.timer = setTimeout(() => {
        try {
          this.child.kill('SIGKILL');
        } catch {
          /* Ownership remains until close. */
        }
      }, SHUTDOWN_GRACE_MS);
    }
    return this.completion.promise;
  }
}
