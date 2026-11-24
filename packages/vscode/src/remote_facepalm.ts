import {
  LOCAL_AUDIO_VERSION,
  type FacepalmBeatKind,
  type FacepalmCue,
  type FacepalmSnapshot,
  type LocalAudioFrame,
} from '@ai-pair/protocol';
import type { FacepalmPort } from '@ai-pair/core';

/** Maximum extra time for the local service and attachment to return a beat. */
const RESPONSE_MARGIN_MS = 20_000;

/** The selected attachment and its ordered command sender. */
export interface RemoteFacepalmOptions {
  epoch: string;
  page: () => number | undefined;
  nextSequence: () => number;
  send: (frame: LocalAudioFrame) => void;
}

/** Routes Facepalm intent to the UI-local owner and rejects retired replies. */
export class RemoteFacepalm implements FacepalmPort {
  private generation = 1;
  private nextRequest = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    { generation: number; page: number; timer: ReturnType<typeof setTimeout>; resolve: (cue: FacepalmCue | undefined) => void }
  >();
  private status: FacepalmSnapshot = { enabled: true, status: 'unchecked', available: true, canOpenSettings: false };
  /** Receives local owner snapshots. */
  onStatus?: (snapshot: FacepalmSnapshot) => void;

  constructor(private readonly options: RemoteFacepalmOptions) {}

  /** Returns the most recent local owner snapshot. */
  snapshot(): FacepalmSnapshot {
    return this.status;
  }

  /** Accepts a current result or local status. */
  accept(frame: LocalAudioFrame): void {
    if (this.closed || frame.connectionEpoch !== this.options.epoch) return;
    // specs/LocalFacepalm.tla, Deliver: only the current owner and request may settle.
    if (frame.type === 'facepalmStatus') {
      this.status = frame.snapshot;
      try {
        this.onStatus?.(this.status);
      } catch {
        /* Observers cannot interrupt the shared attachment. */
      }
    } else if (frame.type === 'facepalmResult') {
      const pending = this.pending.get(frame.requestId);
      if (
        pending === undefined ||
        pending.generation !== frame.generation ||
        pending.page !== frame.pageEpoch ||
        this.options.page() !== frame.pageEpoch ||
        this.generation !== frame.generation
      ) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(frame.requestId);
      pending.resolve(frame.cue);
    }
  }

  /** Requests one beat without holding the command acknowledgement until its result. */
  markBeat(kind: FacepalmBeatKind, windowMs: number): Promise<FacepalmCue | undefined> {
    const page = this.options.page();
    if (this.closed || page === undefined || !this.status.enabled || this.pending.size !== 0) return Promise.resolve(undefined);
    // specs/LocalFacepalm.tla, Accept: bound admission and acknowledge independently of the result.
    const requestId = ++this.nextRequest;
    const generation = this.generation;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.retire();
      }, windowMs + RESPONSE_MARGIN_MS);
      this.pending.set(requestId, { generation, page, timer, resolve });
      this.options.send({ ...this.envelope(), type: 'facepalmBeat', pageEpoch: page, generation, requestId, kind, windowMs });
    });
  }

  /** Invalidates pending work before asking the local owner to retire. */
  retire(): void {
    // specs/LocalFacepalm.tla, Retire: invalidate the generation before sending retirement.
    const page = this.options.page();
    const generation = this.generation++;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.pending.clear();
    if (!this.closed && page !== undefined) this.options.send({ ...this.envelope(), type: 'facepalmRetire', pageEpoch: page, generation });
  }

  /** Sends feedback only for the current page and generation. */
  feel(id: number, feeling: FacepalmCue['feeling']): Promise<void> {
    const page = this.options.page();
    if (!this.closed && page !== undefined && this.status.enabled) {
      this.options.send({ ...this.envelope(), type: 'facepalmFeel', pageEpoch: page, generation: this.generation, id, feeling });
    }
    return Promise.resolve();
  }

  /** Forwards desired admission to the local owner. */
  setEnabled(enabled: boolean): void {
    if (!enabled) this.retire();
    if (!this.closed) this.options.send({ ...this.envelope(), type: 'facepalmEnabled', enabled });
  }

  /** Requests a local nonconnecting inspection. */
  refresh(): void {
    if (!this.closed) this.options.send({ ...this.envelope(), type: 'facepalmRefresh' });
  }
  /** Opens settings on the local host. */
  openSettings(): void {
    if (!this.closed) this.options.send({ ...this.envelope(), type: 'facepalmOpenSettings' });
  }
  /** Invalidates all work and closes the proxy. */
  dispose(): void {
    if (this.closed) return;
    this.retire();
    this.closed = true;
  }
  private envelope(): { version: typeof LOCAL_AUDIO_VERSION; connectionEpoch: string; sequence: number } {
    return { version: LOCAL_AUDIO_VERSION, connectionEpoch: this.options.epoch, sequence: this.options.nextSequence() };
  }
}
