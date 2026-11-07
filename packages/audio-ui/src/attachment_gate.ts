import { localAudioPrepare, localAudioPrepared, type LocalAudioPrepared } from '@ai-pair/protocol';

/** Dependencies of the companion's bounded provider-registration handshake. */
export interface AttachmentGateOptions {
  token: () => string;
  timeoutMs: number;
  register: () => void;
}

/** Allows one provider registration only after a current preparation is committed. */
export class AttachmentGate {
  private pending?: LocalAudioPrepared;
  private attached = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: AttachmentGateOptions) {}

  /** Prepares an expiring token without registering a panel provider. */
  prepare(value: unknown): LocalAudioPrepared | undefined {
    const parsed = localAudioPrepare.safeParse(value);
    if (!parsed.success || this.closed || this.attached || this.pending !== undefined) return undefined;
    const prepared = localAudioPrepared.safeParse({ ...parsed.data, token: this.options.token() });
    if (!prepared.success) return undefined;
    this.pending = prepared.data;
    // specs/PanelPlacement.tla, ExpireBeforeCommit: a late commit cannot register a provider.
    this.timer = setTimeout(() => {
      this.pending = undefined;
    }, this.options.timeoutMs);
    return prepared.data;
  }

  /** Registers once only when the matching unexpired token is committed. */
  commit(value: unknown): boolean {
    const parsed = localAudioPrepared.safeParse(value);
    if (!parsed.success || this.closed || this.attached || this.pending === undefined) return false;
    if (parsed.data.epoch !== this.pending.epoch || parsed.data.token !== this.pending.token) return false;
    // specs/PanelPlacement.tla, Commit: a failed registration does not permit another owner.
    this.attached = true;
    this.pending = undefined;
    clearTimeout(this.timer);
    this.options.register();
    return true;
  }

  /** Rejects later preparation and commit requests. */
  dispose(): void {
    this.closed = true;
    this.pending = undefined;
    clearTimeout(this.timer);
  }
}
