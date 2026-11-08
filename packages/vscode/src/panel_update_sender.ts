import { LOCAL_AUDIO_VERSION, localPanelUpdate, splitPanelUpdate, type LocalAudioFrame, type LocalPanelUpdate } from '@ai-pair/protocol';

/** Maximum queued visible updates while a companion is slow. */
const MAX_PENDING_UPDATES = 512;

/** Connection callbacks for bounded workspace-to-panel updates. */
export interface PanelUpdateSenderOptions {
  epoch: string;
  page: () => number | undefined;
  nextSequence: () => number;
  send: (frame: LocalAudioFrame) => Promise<boolean>;
  unavailable: () => void;
}

/** Serializes visible updates into bounded frames without carrying speech data. */
export class PanelUpdateSender {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private nextMessage = 0;
  private reported = false;

  constructor(private readonly options: PanelUpdateSenderOptions) {}

  /** Queues a validated update for the current page. */
  post(value: unknown): Promise<boolean> {
    const parsed = localPanelUpdate.safeParse(value);
    const page = this.options.page();
    if (!parsed.success || page === undefined) return Promise.resolve(false);
    if (this.pending >= MAX_PENDING_UPDATES) {
      this.reportUnavailable();
      return Promise.resolve(false);
    }
    this.pending++;
    const result = this.tail.then(() => this.transmit(parsed.data, page));
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result.finally(() => {
      this.pending--;
    });
  }

  /** Reports a transfer problem once for this connection. */
  private reportUnavailable(): void {
    if (this.reported) return;
    this.reported = true;
    this.options.unavailable();
  }

  /** Sends replay one event at a time to preserve replay semantics and frame bounds. */
  private async transmit(update: LocalPanelUpdate, page: number): Promise<boolean> {
    const updates: LocalPanelUpdate[] =
      update.type === 'replay' && update.events.length > 0 ? update.events.map((event) => ({ type: 'replay', events: [event] })) : [update];
    let complete = true;
    for (const item of updates) {
      let chunks: ReturnType<typeof splitPanelUpdate>;
      try {
        chunks = splitPanelUpdate(item, { pageEpoch: page, messageId: ++this.nextMessage });
      } catch {
        this.reportUnavailable();
        complete = false;
        continue;
      }
      for (const chunk of chunks) {
        if (this.options.page() !== page) return false;
        const sent = await this.options.send({
          version: LOCAL_AUDIO_VERSION,
          connectionEpoch: this.options.epoch,
          sequence: this.options.nextSequence(),
          type: 'panelChunk',
          ...chunk,
        });
        if (!sent) {
          this.reportUnavailable();
          return false;
        }
      }
    }
    return complete;
  }
}
