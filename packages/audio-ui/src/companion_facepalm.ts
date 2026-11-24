import { localAudioFrame, LOCAL_AUDIO_VERSION, type FacepalmBeatKind, type FacepalmCue, type LocalAudioFrame } from '@ai-pair/protocol';

/** Local subscription operations used by the companion bridge. */
export interface CompanionFacepalmClient {
  markBeat(kind: FacepalmBeatKind, windowMs: number): Promise<FacepalmCue | undefined>;
  feel(id: number, feeling: FacepalmCue['feeling']): Promise<void>;
  retire(): void;
  dispose(): Promise<void>;
  setEnabled(enabled: boolean): void;
  refresh(remote: boolean, remoteHost?: boolean): Promise<void>;
}

/** Dependencies for the UI host's Facepalm command adapter. */
export interface CompanionFacepalmOptions {
  client: CompanionFacepalmClient;
  epoch: string;
  page: () => number | undefined;
  nextSequence: () => number;
  send: (frame: LocalAudioFrame) => void;
  openSettings: () => void;
}

/** Dispatches admitted Facepalm work without blocking the attachment command channel. */
export class CompanionFacepalm {
  private generation = 1;
  private closed = false;
  private disposal?: Promise<void>;
  constructor(private readonly options: CompanionFacepalmOptions) {}

  /** Handles validated, ordered frames from the current attachment. */
  accept(frame: LocalAudioFrame): void {
    if (this.closed || frame.connectionEpoch !== this.options.epoch) return;
    if (frame.type === 'facepalmEnabled') {
      this.options.client.setEnabled(frame.enabled);
      return;
    }
    if (frame.type === 'facepalmRefresh') {
      void this.options.client.refresh(false);
      return;
    }
    if (frame.type === 'facepalmOpenSettings') {
      this.options.openSettings();
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
