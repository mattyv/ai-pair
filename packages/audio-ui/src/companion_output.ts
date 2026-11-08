import {
  MAX_AUDIO_PARTS,
  type AudioAdapter,
  type AudioChoice,
  type AudioEvent,
  type AudioLease,
  type AudioOwner,
} from '../../audio-native/src';
import type { SpeechAudioEvent, SpeechOutput } from '../../vscode/src/speech_service';

/** Dependencies for a UI-local output that reserves a route before synthesis. */
export interface CompanionOutputOptions {
  adapter: AudioAdapter;
  connectionEpoch: string;
  page: () => number | undefined;
  choice: () => AudioChoice;
  ready: () => boolean;
  event: (event: SpeechAudioEvent) => void;
  status: SpeechOutput['status'];
  localDiagnostic?: SpeechOutput['localDiagnostic'];
}

interface Request {
  id: number;
  owner: AudioOwner;
  canceled: boolean;
  sequence: number;
  lease?: AudioLease;
  playing: boolean;
  nextPart: number;
  part?: number;
}

/** Connects the shared speech service to a UI-local native output adapter. */
export class CompanionOutput implements SpeechOutput {
  readonly parts = true;
  private current?: Request;
  private readonly subscription: { dispose(): void };

  constructor(private readonly options: CompanionOutputOptions) {
    this.subscription = options.adapter.onEvent((event) => {
      this.onEvent(event);
    });
  }

  /** Snapshots and reserves a route before the provider is called. */
  async prepare(id: number): Promise<boolean> {
    const page = this.options.page();
    if (page === undefined || this.current !== undefined || !this.options.ready()) return false;
    const request: Request = {
      id,
      owner: { connectionEpoch: this.options.connectionEpoch, jobId: String(id), pageEpoch: page },
      canceled: false,
      sequence: 0,
      playing: false,
      nextPart: 0,
    };
    this.current = request;
    try {
      // specs/LocalAudioAdmission.tla, Admit: route admission precedes provider dispatch.
      const lease = await this.options.adapter.admit(request.owner, this.options.choice());
      if (request.canceled) {
        await this.retire(request);
        return false;
      }
      request.lease = lease;
      return true;
    } catch {
      await this.retire(request);
      return false;
    }
  }

  /** Begins playback on the reserved route without sending PCM over the workspace bridge. */
  play(id: number, wav: Uint8Array, durationMs?: number, part = 0): number | undefined {
    void durationMs;
    const request = this.current;
    if (
      request === undefined ||
      request.id !== id ||
      request.canceled ||
      request.lease === undefined ||
      request.playing ||
      !Number.isSafeInteger(part) ||
      part !== request.nextPart ||
      part >= MAX_AUDIO_PARTS
    ) {
      return undefined;
    }
    request.playing = true;
    request.part = part;
    void this.options.adapter.play(request.lease, wav, part).catch(() => {
      if (this.current !== request || request.canceled || request.part !== part) return;
      request.canceled = true;
      this.notify({ id, pageId: request.owner.pageEpoch, event: 'failed', part });
      void this.retire(request);
    });
    return request.owner.pageEpoch;
  }

  /** Controls only the owning job and page. */
  control(id: number, pageId: number, action: 'pause' | 'resume' | 'stop'): void {
    const request = this.current;
    if (request === undefined || request.id !== id || request.owner.pageEpoch !== pageId) return;
    if (action === 'stop') {
      request.canceled = true;
      if (request.lease !== undefined) void this.retire(request);
      else void this.options.adapter.stop(request.owner).catch(() => {});
    } else if (!request.canceled) {
      void this.options.adapter[action](request.owner).catch(() => {});
    }
  }

  /** Cancels an admission or reserved route before playback starts. */
  cancel(id: number): void {
    const request = this.current;
    if (request !== undefined && request.id === id) this.control(id, request.owner.pageEpoch, 'stop');
  }

  /** Waits until the current native output has physically stopped. */
  async stopAndWait(): Promise<void> {
    const request = this.current;
    if (request === undefined) return;
    request.canceled = true;
    await this.options.adapter.stop(request.owner);
    if (request.lease !== undefined && this.current === request) this.current = undefined;
  }

  /** Forwards fixed worker lifecycle categories to local diagnostics. */
  localDiagnostic: SpeechOutput['localDiagnostic'] = (phase, reason) => {
    this.options.localDiagnostic?.(phase, reason);
  };

  /** Reports local speech state to the local panel. */
  status(id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string): void {
    this.options.status(id, state, message);
  }

  /** Stops the current output and releases the adapter event subscription. */
  dispose(): void {
    const request = this.current;
    if (request !== undefined) this.control(request.id, request.owner.pageEpoch, 'stop');
    this.subscription.dispose();
  }

  /** Forwards only current, ordered events and retains ownership until retirement. */
  private onEvent(event: AudioEvent): void {
    const request = this.current;
    if (
      request === undefined ||
      request.canceled ||
      !request.playing ||
      event.sequence <= request.sequence ||
      event.part !== request.part ||
      event.owner.connectionEpoch !== request.owner.connectionEpoch ||
      event.owner.jobId !== request.owner.jobId ||
      event.owner.pageEpoch !== request.owner.pageEpoch
    ) {
      return;
    }
    request.sequence = event.sequence;
    if (event.type === 'ended') {
      request.playing = false;
      request.nextPart = event.part + 1;
    } else if (event.type !== 'started') {
      request.canceled = true;
    }
    this.notify({
      id: request.id,
      pageId: request.owner.pageEpoch,
      event: event.type === 'canceled' ? 'failed' : event.type,
      part: event.part,
    });
    if (event.type !== 'started' && event.type !== 'ended') void this.retire(request);
  }

  /** Observer failures must not prevent physical retirement. */
  private notify(event: SpeechAudioEvent): void {
    try {
      this.options.event(event);
    } catch {
      // A failed observer cannot retain the output lease indefinitely.
    }
  }

  /** Keeps the slot closed until the adapter confirms physical retirement. */
  private async retire(request: Request): Promise<void> {
    try {
      // specs/LocalAudioOwnership.tla, ChildExit: a terminal outcome alone does not release ownership.
      await this.options.adapter.stop(request.owner);
      if (this.current === request) this.current = undefined;
    } catch {
      // Retain the slot when retirement cannot be confirmed.
    }
  }
}
