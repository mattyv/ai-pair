import {
  LOCAL_AUDIO_VERSION,
  PANEL_CHUNK_UNITS,
  localPanelUpdate,
  splitPanelUpdate,
  type LocalAudioFrame,
  type LocalPanelUpdate,
} from '@ai-pair/protocol';

/** Maximum queued visible updates while a companion is slow. */
const MAX_PENDING_UPDATES = 512;
/** The chunks one batch of replay events may fill: far under the transfer limit (#118). */
const MAX_BATCH_CHUNKS = 64;
/** The most one batch of replay events serializes to. */
const MAX_BATCH_UNITS = PANEL_CHUNK_UNITS * MAX_BATCH_CHUNKS;

/** The units a replay update takes around its events, so the bound counts the whole message (specs/ReplayBatching.tla, Bounded). */
const REPLAY_ENVELOPE_UNITS = JSON.stringify({ type: 'replay', events: [] }).length;

/** One event of a replay. */
type ReplayEvent = Extract<LocalPanelUpdate, { type: 'replay' }>['events'][number];

/**
 * Groups a replay's events into ordered batches, each sent as one message, so a long history costs a few
 * cross-host round trips instead of one per event (specs/ReplayBatching.tla, SendBatch). A session event,
 * which the companion acts on alone, and an event over the batch bound each go alone (SessionAlone, Bounded);
 * otherwise a batch takes every following event that fits (Packed).
 */
function replayBatches(events: readonly ReplayEvent[]): ReplayEvent[][] {
  const batches: ReplayEvent[][] = [];
  let current: ReplayEvent[] = [];
  let units = 0;
  for (const event of events) {
    const size = JSON.stringify(event).length;
    if (event.type === 'session' || REPLAY_ENVELOPE_UNITS + size > MAX_BATCH_UNITS) {
      if (current.length > 0) batches.push(current);
      batches.push([event]);
      current = [];
      units = 0;
      continue;
    }
    // One more for the comma that joins it to the batch.
    if (current.length > 0 && REPLAY_ENVELOPE_UNITS + units + 1 + size > MAX_BATCH_UNITS) {
      batches.push(current);
      current = [];
      units = 0;
    }
    units += (current.length > 0 ? 1 : 0) + size;
    current.push(event);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

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

  /** Sends a replay in ordered batches, within frame bounds; an event too large to transfer is reported and skipped. */
  private async transmit(update: LocalPanelUpdate, page: number): Promise<boolean> {
    const updates: LocalPanelUpdate[] =
      update.type === 'replay' && update.events.length > 0
        ? replayBatches(update.events).map((events) => ({ type: 'replay', events }))
        : [update];
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
