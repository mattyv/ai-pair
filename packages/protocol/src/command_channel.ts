/** Transport and bounds for a serial VS Code command channel. */
export interface CommandChannelOptions<T> {
  send: (frame: T) => Promise<void>;
  timeoutMs: number;
  maxPending: number;
  lost: () => void;
}

interface Pending<T> {
  frame: T;
  resolve: (delivered: boolean) => void;
}

/** Preserves frame order and fails closed on a bounded communication loss. */
export class CommandChannel<T> {
  private readonly queue: Array<Pending<T>> = [];
  private current?: Pending<T>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private readonly options: CommandChannelOptions<T>) {}

  /** Queues one frame, or closes if the bounded queue is full. */
  send(frame: T): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.queue.length + (this.current === undefined ? 0 : 1) >= this.options.maxPending) {
      this.dispose();
      return Promise.resolve(false);
    }
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.queue.push({ frame, resolve });
    this.dispatch();
    return promise;
  }

  /** Stops dispatch, settles queued callers and reports the lost connection once. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.current?.resolve(false);
    this.current = undefined;
    for (const pending of this.queue.splice(0)) {
      pending.resolve(false);
    }
    this.options.lost();
  }

  /** Dispatches one frame and waits for its bounded acknowledgement. */
  private dispatch(): void {
    if (this.closed || this.current !== undefined) return;
    const pending = this.queue.shift();
    if (pending === undefined) return;
    this.current = pending;
    this.timer = setTimeout(() => {
      this.dispose();
    }, this.options.timeoutMs);
    let sent: Promise<void>;
    try {
      sent = this.options.send(pending.frame);
    } catch {
      this.dispose();
      return;
    }
    void sent.then(
      () => {
        if (this.closed || this.current !== pending) return;
        clearTimeout(this.timer);
        this.current = undefined;
        pending.resolve(true);
        this.dispatch();
      },
      () => {
        this.dispose();
      },
    );
  }
}
