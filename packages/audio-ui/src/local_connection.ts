import { localAudioFrame, type LocalAudioFrame } from '@ai-pair/protocol';

/** Callbacks and duration for the local connection's bounded heartbeat lease. */
export interface LocalConnectionOptions {
  leaseMs: number;
  receive: (frame: LocalAudioFrame) => void;
  lost: () => void;
}

/** Rejects stale frames and retires local work when the connection lease expires. */
export class LocalConnection {
  private epoch?: string;
  private sequence = 0;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: LocalConnectionOptions) {}

  /** Attaches once for the lifetime of this window. */
  attach(value: unknown): boolean {
    const parsed = localAudioFrame.safeParse(value);
    if (this.closed || this.epoch !== undefined || !parsed.success || parsed.data.type !== 'attach') return false;
    this.epoch = parsed.data.connectionEpoch;
    this.sequence = parsed.data.sequence;
    this.renew();
    return true;
  }

  /** Accepts only newer commands from the attached connection. */
  accept(value: unknown): boolean {
    const parsed = localAudioFrame.safeParse(value);
    if (!parsed.success || this.closed || this.epoch === undefined) return false;
    const frame = parsed.data;
    if (
      frame.connectionEpoch !== this.epoch ||
      frame.sequence <= this.sequence ||
      frame.type === 'attach' ||
      frame.type === 'terminal' ||
      frame.type === 'panelAction'
    ) {
      return false;
    }
    this.sequence = frame.sequence;
    // specs/LocalAudioOwnership.tla, Heartbeat: only a current heartbeat renews the lease.
    if (frame.type === 'heartbeat') this.renew();
    this.options.receive(frame);
    return true;
  }

  /** Retires locally once, including when the panel or extension is disposed. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    if (this.epoch !== undefined) this.options.lost();
  }

  /** Resets the bounded lease after attachment or a current heartbeat. */
  private renew(): void {
    clearTimeout(this.timer);
    // specs/LocalAudioOwnership.tla, LeaseExpired: expiry stops local work before accepting more frames.
    this.timer = setTimeout(() => {
      this.dispose();
    }, this.options.leaseMs);
  }
}
