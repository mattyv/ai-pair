import {
  LOCAL_AUDIO_VERSION,
  type FacepalmBeatKind,
  type FacepalmCue,
  type FacepalmSnapshot,
  type FacepalmSettingsLaunch,
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
  send: (frame: LocalAudioFrame) => void | Promise<boolean>;
}

/** One bounded, page-scoped settings action and its caller. */
type ControlResult = Extract<LocalAudioFrame, { type: 'facepalmControlResult' }>['result'];
interface PendingControl {
  page: number;
  id: number;
  operation: 'open' | 'recheck';
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: ControlResult | undefined) => void;
}

/** Routes Facepalm intent to the UI-local owner and rejects retired replies. */
export class RemoteFacepalm implements FacepalmPort {
  private generation = 1;
  private nextRequest = 0;
  private closed = false;
  private nextControl = 0;
  private control?: PendingControl;
  private acceptedSettings?: { page: number; id: number };
  /** Receives a sanitized later failure for the still-current settings request. */
  onSettingsFailure?: (failure: Extract<FacepalmSettingsLaunch, { state: 'failed' }>) => void;
  private readonly pending = new Map<
    number,
    { generation: number; page: number; timer: ReturnType<typeof setTimeout>; resolve: (cue: FacepalmCue | undefined) => void }
  >();
  private status: FacepalmSnapshot = { enabled: true, status: 'unchecked', available: true, canOpenSettings: false };
  /** Receives local owner snapshots. */
  onStatus?: (snapshot: FacepalmSnapshot) => void;

  constructor(private readonly options: RemoteFacepalmOptions) {}

  /** Returns the currently attached page identity. */
  currentPage(): number | undefined {
    return this.options.page();
  }

  /** Returns the most recent local owner snapshot. */
  snapshot(): FacepalmSnapshot {
    return this.status;
  }

  /** Accepts a current result or local status. */
  accept(frame: LocalAudioFrame): void {
    if (this.closed || frame.connectionEpoch !== this.options.epoch) return;
    // specs/LocalFacepalm.tla, Deliver: only the current owner and request may settle.
    if (frame.type === 'facepalmStatus') {
      if (frame.pageEpoch !== (this.options.page() ?? 0)) return;
      this.status = frame.snapshot;
      try {
        this.onStatus?.(this.status);
      } catch {
        /* Observers cannot interrupt the shared attachment. */
      }
    } else if (frame.type === 'facepalmControlResult') {
      const control = this.control;
      if (
        control === undefined ||
        control.page !== frame.pageEpoch ||
        control.id !== frame.requestId ||
        control.operation !== frame.result.operation ||
        this.options.page() !== control.page
      ) {
        return;
      }
      if (frame.result.operation === 'recheck' && frame.result.outcome.state === 'checked') {
        this.status = frame.result.outcome.snapshot;
        try {
          this.onStatus?.(this.status);
        } catch {
          /* Observers cannot interrupt the attachment. */
        }
      }
      if (frame.result.operation === 'open' && frame.result.outcome.state === 'accepted') {
        this.acceptedSettings = { page: control.page, id: control.id };
      }
      this.finishControl(control, frame.result);
    } else if (frame.type === 'facepalmSettingsNotice') {
      const accepted = this.acceptedSettings;
      if (
        accepted === undefined ||
        accepted.page !== frame.pageEpoch ||
        accepted.id !== frame.requestId ||
        this.options.page() !== accepted.page
      ) {
        return;
      }
      try {
        this.onSettingsFailure?.(frame.failure);
      } catch {
        /* Observers cannot interrupt the attachment. */
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
      this.sendBestEffort({ ...this.envelope(), type: 'facepalmBeat', pageEpoch: page, generation, requestId, kind, windowMs }, () => {
        if (this.generation === generation && this.pending.has(requestId)) this.retire();
      });
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
    if (!this.closed && page !== undefined) {
      this.sendBestEffort({ ...this.envelope(), type: 'facepalmRetire', pageEpoch: page, generation });
    }
  }

  /** Sends feedback only for the current page and generation. */
  feel(id: number, feeling: FacepalmCue['feeling']): Promise<void> {
    const page = this.options.page();
    if (!this.closed && page !== undefined && this.status.enabled) {
      this.sendBestEffort({ ...this.envelope(), type: 'facepalmFeel', pageEpoch: page, generation: this.generation, id, feeling });
    }
    return Promise.resolve();
  }

  /** Forwards desired admission to the local owner. */
  setEnabled(enabled: boolean): void {
    if (!enabled) this.retire();
    if (!this.closed) this.sendBestEffort({ ...this.envelope(), type: 'facepalmEnabled', enabled });
  }

  /** Requests a local nonconnecting inspection. */
  async refresh(): Promise<FacepalmSettingsLaunch | undefined> {
    const result = await this.requestControl('recheck');
    return result?.operation === 'recheck' && result.outcome.state === 'failed' ? result.outcome : undefined;
  }
  /** Requests local settings and returns admission or a sanitized failure. */
  async openSettings(): Promise<FacepalmSettingsLaunch | undefined> {
    const result = await this.requestControl('open');
    return result?.operation === 'open' ? result.outcome : undefined;
  }
  /** Invalidates a page's pending actions and later diagnostics. */
  pageChanged(): void {
    this.acceptedSettings = undefined;
    if (this.control !== undefined) this.finishControl(this.control, undefined);
  }
  /** Invalidates all work and closes the proxy. */
  dispose(): void {
    if (this.closed) return;
    this.retire();
    this.closed = true;
    this.acceptedSettings = undefined;
    if (this.control !== undefined) this.failControl(this.control, 'disconnected');
  }
  /** Starts one bounded action without blocking the transport acknowledgement. */
  private requestControl(operation: 'open' | 'recheck'): Promise<ControlResult | undefined> {
    const page = this.options.page();
    function failure(reason: 'disconnected' | 'busy'): ControlResult {
      return operation === 'open'
        ? { operation, outcome: { state: 'failed', reason } }
        : { operation, outcome: { state: 'failed', reason } };
    }
    if (this.closed || page === undefined) return Promise.resolve(failure('disconnected'));
    if (this.control !== undefined) return Promise.resolve(failure('busy'));
    this.acceptedSettings = undefined;
    const id = ++this.nextControl;
    return new Promise((resolve) => {
      const control: PendingControl = {
        page,
        id,
        operation,
        resolve,
        timer: setTimeout(() => {
          this.failControl(control, 'timeout');
        }, RESPONSE_MARGIN_MS),
      };
      this.control = control;
      const frame: LocalAudioFrame = {
        ...this.envelope(),
        type: operation === 'open' ? 'facepalmOpenSettings' : 'facepalmRefresh',
        pageEpoch: page,
        requestId: id,
      };
      try {
        void Promise.resolve(this.options.send(frame)).then(
          (accepted) => {
            if (accepted === false) this.failControl(control, 'disconnected');
          },
          () => {
            this.failControl(control, 'disconnected');
          },
        );
      } catch {
        this.failControl(control, 'disconnected');
      }
    });
  }
  /** Settles exactly the action that owns the pending slot. */
  private finishControl(control: PendingControl, result: ControlResult | undefined): void {
    if (this.control !== control) return;
    clearTimeout(control.timer);
    this.control = undefined;
    control.resolve(result);
  }
  /** Reports a bounded transport or deadline failure to the current caller. */
  private failControl(control: PendingControl, reason: 'timeout' | 'disconnected'): void {
    const result: ControlResult =
      control.operation === 'open'
        ? { operation: 'open', outcome: { state: 'failed', reason } }
        : { operation: 'recheck', outcome: { state: 'failed', reason } };
    this.finishControl(control, result);
  }
  /** Contains transport errors and optionally settles the effect that sent the frame. */
  private sendBestEffort(frame: LocalAudioFrame, failed?: () => void): void {
    try {
      void Promise.resolve(this.options.send(frame)).then(
        (accepted) => {
          if (accepted === false) failed?.();
        },
        () => {
          failed?.();
        },
      );
    } catch {
      failed?.();
    }
  }
  private envelope(): { version: typeof LOCAL_AUDIO_VERSION; connectionEpoch: string; sequence: number } {
    return { version: LOCAL_AUDIO_VERSION, connectionEpoch: this.options.epoch, sequence: this.options.nextSequence() };
  }
}
