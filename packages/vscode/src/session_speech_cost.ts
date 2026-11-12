/** A sanitized reason a session subtotal may be incomplete. */
export type SpeechCostReason = 'restored' | 'missing-generation-id' | 'generation-not-published' | 'generation-lookup-failed';
/** A confirmed charge or a sanitized reason it could not be established. */
export type SpeechCostResult = number | Exclude<SpeechCostReason, 'restored'> | undefined;

/** A bounded snapshot of provider-confirmed speech charges in this pairing session. */
export interface SessionSpeechCostView {
  seen: boolean;
  total: number;
  pending: number;
  partial: boolean;
  reasons?: SpeechCostReason[];
}

/** Owns the current pairing session's local speech cost and rejects late results. */
export class SessionSpeechCost {
  private epoch = 0;
  private active = false;
  private snapshot: SessionSpeechCostView = { seen: false, total: 0, pending: 0, partial: false };

  constructor(private readonly changed: (view: SessionSpeechCostView) => void) {}

  /** Starts an empty ledger for a new pairing session. */
  start(): void {
    this.epoch++;
    this.active = true;
    this.snapshot = { seen: false, total: 0, pending: 0, partial: false };
    this.publish();
  }

  /** Restores a live session without claiming unknown earlier charges are zero. */
  restore(): void {
    if (this.active) return;
    this.epoch++;
    this.active = true;
    this.snapshot = { seen: true, total: 0, pending: 0, partial: true, reasons: ['restored'] };
    this.publish();
  }

  /** Retains the final subtotal until the next session begins. */
  end(): void {
    this.active = false;
  }

  /** Reserves one provider request and returns its once-only completion. */
  begin(): ((cost: SpeechCostResult) => void) | undefined {
    return this.capture()?.();
  }

  /** Captures the pairing session before a request waits for admission or credentials. */
  capture(): (() => ((cost: SpeechCostResult) => void) | undefined) | undefined {
    if (!this.active) return undefined;
    const epoch = this.epoch;
    let dispatched = false;
    return () => {
      if (dispatched || epoch !== this.epoch) return undefined;
      dispatched = true;
      return this.record(epoch);
    };
  }

  private record(epoch: number): (cost: SpeechCostResult) => void {
    let settled = false;
    this.snapshot = { ...this.snapshot, seen: true, pending: this.snapshot.pending + 1 };
    this.publish();
    return (cost) => {
      if (settled || epoch !== this.epoch) return;
      settled = true;
      const valid = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && Number.isFinite(this.snapshot.total + cost);
      this.snapshot = {
        ...this.snapshot,
        total: this.snapshot.total + (valid ? cost : 0),
        pending: this.snapshot.pending - 1,
        partial: this.snapshot.partial || !valid,
        ...(!valid
          ? { reasons: [...new Set([...(this.snapshot.reasons ?? []), typeof cost === 'string' ? cost : 'generation-lookup-failed'])] }
          : {}),
      };
      this.publish();
    };
  }

  /** Returns an immutable snapshot for page recreation. */
  view(): SessionSpeechCostView {
    return { ...this.snapshot, ...(this.snapshot.reasons === undefined ? {} : { reasons: [...this.snapshot.reasons] }) };
  }

  private publish(): void {
    try {
      this.changed(this.view());
    } catch {
      // A page observer must never change billing or narration behavior.
    }
  }
}
