/** How a lost Local Audio connection is retried. */
export interface CompanionReconnectOptions {
  /** The wait before each attempt; there are as many attempts as waits. */
  delaysMs: readonly number[];
  /** Returns a new connection epoch for an attempt. */
  newEpoch: () => string;
  /** Prepares and commits a connection with the epoch; resolves whether the companion took it. */
  attempt: (epoch: string) => Promise<boolean>;
  /** Reports a connection made again, and after how many attempts. */
  connected: (attempts: number) => void;
  /** Reports that every attempt failed, so the programmer is told to reload. */
  failed: () => void;
}

/**
 * Reconnects to AI Pair Local Audio after a lost connection (specs/LocalAudioReconnect.tla, #127): a bounded number of
 * attempts, each after its wait and with a new epoch, until one connects; only when all fail is the programmer warned
 * (`NoNeedlessWarning`). One run at a time; a loss after a reconnect starts a new run.
 */
export class CompanionReconnect {
  private running = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CompanionReconnectOptions) {}

  /** Starts retrying after a loss, unless a run is under way or the window is closing. */
  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    void this.run();
  }

  /** Stops retrying, as the window closes. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  /** Tries each attempt in turn after its wait (Attempt), stopping at the first that connects (Attach). */
  private async run(): Promise<void> {
    for (const [index, delay] of this.options.delaysMs.entries()) {
      // dispose() clears this timer, so a closed window never wakes the loop again.
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, delay);
      });
      const connected = await this.options.attempt(this.options.newEpoch()).catch(() => false);
      if (this.disposed) return;
      if (connected) {
        this.running = false;
        this.options.connected(index + 1);
        return;
      }
    }
    // specs/LocalAudioReconnect.tla, AttemptFails: the last attempt failed, so the programmer is told.
    this.running = false;
    this.options.failed();
  }
}
