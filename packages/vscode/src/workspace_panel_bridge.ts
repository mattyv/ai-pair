import { localAudioFrame, type LocalAudioFrame, type LocalPanelAction } from '@ai-pair/protocol';

/** Callbacks for validated companion-originated panel frames. */
export interface WorkspacePanelBridgeOptions {
  epoch: string;
  action: (action: LocalPanelAction) => void;
  terminal: (frame: Extract<LocalAudioFrame, { type: 'terminal' }>) => void;
  pageChanged: () => void;
}

/** Rejects stale companion actions and acknowledgements before workspace dispatch. */
export class WorkspacePanelBridge {
  private lastSequence = 0;
  private pageEpoch?: number;
  private lastPage = 0;
  private closed = false;

  constructor(private readonly options: WorkspacePanelBridgeOptions) {}

  /** Returns the current ready page identity. */
  page(): number | undefined {
    return this.pageEpoch;
  }

  /** Accepts only newer frames in the companion-to-workspace direction. */
  accept(value: unknown): boolean {
    const parsed = localAudioFrame.safeParse(value);
    if (!parsed.success || this.closed) return false;
    const frame = parsed.data;
    if (
      frame.connectionEpoch !== this.options.epoch ||
      frame.sequence <= this.lastSequence ||
      (frame.type !== 'terminal' && frame.type !== 'panelAction')
    ) {
      return false;
    }
    this.lastSequence = frame.sequence;
    // specs/LocalAudioOwnership.tla, Retired: the exact old job may retire after a page change.
    if (frame.type === 'terminal') {
      this.options.terminal(frame);
      return true;
    }
    if (frame.type === 'panelAction' && frame.action.type === 'ready') {
      if (frame.pageEpoch < 1 || frame.pageEpoch < this.lastPage || (this.pageEpoch === undefined && frame.pageEpoch === this.lastPage)) {
        return false;
      }
      if (this.pageEpoch !== undefined && frame.pageEpoch > this.pageEpoch) this.options.pageChanged();
      this.pageEpoch = frame.pageEpoch;
      this.lastPage = frame.pageEpoch;
    }
    if (this.pageEpoch === undefined || frame.pageEpoch !== this.pageEpoch) return false;
    this.options.action(frame.action);
    if (frame.action.type === 'pageClosed') {
      this.options.pageChanged();
      this.pageEpoch = undefined;
    }
    return true;
  }

  /** Rejects late frames once the selected companion connection ends. */
  dispose(): void {
    this.closed = true;
  }
}
