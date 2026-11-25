import {
  localAudioFrame,
  LOCAL_AUDIO_VERSION,
  type FacepalmBeatKind,
  type FacepalmCue,
  type FacepalmSettingsLaunch,
  type FacepalmSnapshot,
  type LocalAudioFrame,
} from '@ai-pair/protocol';

/** Local subscription operations used by the companion bridge. */
export interface CompanionFacepalmClient {
  markBeat(kind: FacepalmBeatKind, windowMs: number): Promise<FacepalmCue | undefined>;
  feel(id: number, feeling: FacepalmCue['feeling']): Promise<void>;
  retire(): void;
  dispose(): Promise<void>;
  setEnabled(enabled: boolean): void;
  refresh(remote: boolean, remoteHost?: boolean, notify?: boolean): Promise<void>;
  snapshot(): FacepalmSnapshot;
}

/** Dependencies for the UI host's Facepalm command adapter. */
export interface CompanionFacepalmOptions {
  client: CompanionFacepalmClient;
  epoch: string;
  page: () => number | undefined;
  nextSequence: () => number;
  send: (frame: LocalAudioFrame) => void;
  diagnostic?: (message: string) => void;
  openSettings: (onLateFailure: (failure: Extract<FacepalmSettingsLaunch, { state: 'failed' }>) => void) => Promise<FacepalmSettingsLaunch>;
}

/** Dispatches admitted Facepalm work without blocking the attachment command channel. */
export class CompanionFacepalm {
  private generation = 1;
  private closed = false;
  private disposal?: Promise<void>;
  private lastControl?: { page: number; id: number; operation: 'open' | 'recheck' };
  constructor(private readonly options: CompanionFacepalmOptions) {}

  /** Handles validated, ordered frames from the current attachment. */
  accept(frame: LocalAudioFrame): void {
    if (this.closed || frame.connectionEpoch !== this.options.epoch) return;
    if (frame.type === 'facepalmEnabled') {
      this.options.client.setEnabled(frame.enabled);
      return;
    }
    if (frame.type === 'facepalmRefresh' || frame.type === 'facepalmOpenSettings') {
      if (frame.pageEpoch !== this.options.page()) return;
      const control = {
        page: frame.pageEpoch,
        id: frame.requestId,
        operation: frame.type === 'facepalmRefresh' ? ('recheck' as const) : ('open' as const),
      };
      this.lastControl = control;
      if (control.operation === 'open') this.report('Facepalm settings request received.');
      const current = (): boolean => !this.closed && this.lastControl === control && this.options.page() === control.page;
      const send = (result: Extract<LocalAudioFrame, { type: 'facepalmControlResult' }>['result']): void => {
        if (!current()) return;
        this.options.send({
          version: LOCAL_AUDIO_VERSION,
          connectionEpoch: this.options.epoch,
          sequence: this.options.nextSequence(),
          type: 'facepalmControlResult',
          pageEpoch: control.page,
          requestId: control.id,
          result,
        });
      };
      // specs/FacepalmSettingsControl.tla, Answer: admission never waits on local effects.
      void Promise.resolve().then(async () => {
        if (!current()) return;
        try {
          if (control.operation === 'recheck') {
            await this.options.client.refresh(false, false, false);
            if (current()) send({ operation: 'recheck', outcome: { state: 'checked', snapshot: this.options.client.snapshot() } });
          } else {
            const outcome = await this.options.openSettings((failure) => {
              if (!current()) return;
              this.report(`Facepalm settings launch failed later: ${failure.reason}.`);
              this.options.send({
                version: LOCAL_AUDIO_VERSION,
                connectionEpoch: this.options.epoch,
                sequence: this.options.nextSequence(),
                type: 'facepalmSettingsNotice',
                pageEpoch: control.page,
                requestId: control.id,
                failure,
              });
            });
            if (current()) {
              this.report(
                outcome.state === 'accepted'
                  ? 'Facepalm settings launch accepted; window visibility is unconfirmed.'
                  : `Facepalm settings launch failed: ${outcome.reason}.`,
              );
            }
            send({ operation: 'open', outcome });
          }
        } catch {
          if (control.operation === 'open' && current()) this.report('Facepalm settings launch failed: start.');
          send(
            control.operation === 'open'
              ? { operation: 'open', outcome: { state: 'failed', reason: 'start' } }
              : { operation: 'recheck', outcome: { state: 'failed', reason: 'inspection' } },
          );
        }
      });
      return;
    }
    if (frame.type !== 'facepalmBeat' && frame.type !== 'facepalmRetire' && frame.type !== 'facepalmFeel') return;
    if (frame.pageEpoch !== this.options.page() || frame.generation < this.generation) return;
    if (frame.generation > this.generation) {
      this.options.client.retire();
      this.generation = frame.generation;
    }
    if (frame.type === 'facepalmRetire') {
      this.retire();
      return;
    }
    // specs/LocalFacepalm.tla, Feel: the local client consumes current cards once.
    if (frame.type === 'facepalmFeel') {
      void this.options.client.feel(frame.id, frame.feeling);
      return;
    }
    const { generation, pageEpoch, requestId } = frame;
    // specs/LocalFacepalm.tla, Answer: do not hold the command acknowledgement while the service waits.
    void this.options.client.markBeat(frame.kind, frame.windowMs).then((cue) => {
      if (this.closed || generation !== this.generation || pageEpoch !== this.options.page()) return;
      const base: Extract<LocalAudioFrame, { type: 'facepalmResult' }> = {
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: this.options.epoch,
        sequence: this.options.nextSequence(),
        type: 'facepalmResult' as const,
        pageEpoch,
        generation,
        requestId,
      };
      const result = localAudioFrame.safeParse({ ...base, ...(cue === undefined ? {} : { cue }) });
      this.options.send(result.success ? result.data : base);
    });
  }

  /** Reports only fixed stages and sanitized failure categories. */
  private report(message: string): void {
    try {
      this.options.diagnostic?.(message);
    } catch {
      /* Diagnostics cannot interrupt the attachment. */
    }
  }

  /** Invalidates results and retires the local subscription. */
  retire(): void {
    this.generation++;
    this.options.client.retire();
  }
  /** Retires once and refuses further commands. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    this.generation++;
    this.disposal = this.options.client.dispose();
    return this.disposal;
  }
}
