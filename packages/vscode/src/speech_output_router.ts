import type { SpeechAudioEvent, SpeechOutput } from './speech_service';
import type { OutputChoice, OutputDevice, OutputUnavailableReason } from './speech_output_types';

export interface OutputDiscovery {
  supported: boolean;
  devices: OutputDevice[];
  reason?: OutputUnavailableReason;
}

export interface NativeDriver {
  available(): boolean;
  play(name: string, wav: Uint8Array, event: (kind: SpeechAudioEvent['event']) => void): boolean;
  control(action: 'pause' | 'resume' | 'stop'): void;
}

interface RouterOptions {
  driver: NativeDriver;
  discover(): Promise<OutputDiscovery>;
  choice(): OutputChoice;
  defaultOutput: SpeechOutput;
  currentPage(): number | undefined;
  audioEvent(event: SpeechAudioEvent): void;
}

/** Reserves one selected route per generation; native failure never falls back. */
export class SpeechOutputRouter implements SpeechOutput {
  private epoch = 0;
  private request = 0;
  private reservation?: { id: number; choice: OutputChoice; epoch: number };
  private active?: { id: number; pageId: number; epoch: number };
  private browser?: { id: number; pageId: number; retiring: boolean };

  constructor(private readonly options: RouterOptions) {}

  async prepare(id: number): Promise<boolean> {
    const epoch = this.epoch;
    // specs/OutputAdmission.tla, Check: only the latest request may reserve.
    const request = ++this.request;
    const choice = this.options.choice();
    this.reservation = undefined;
    // specs/AudioOutput.tla, Reserve: no route starts while a child is owned.
    if (!this.options.driver.available() || this.browser !== undefined) return false;
    if (choice.kind === 'native') {
      let catalog: OutputDiscovery;
      try {
        catalog = await this.options.discover();
      } catch {
        return false;
      }
      if (
        epoch !== this.epoch ||
        request !== this.request ||
        !this.options.driver.available() ||
        this.browser !== undefined ||
        !catalog.supported ||
        !catalog.devices.some(
          (device) => device.available && device.choice.backend === choice.backend && device.choice.name === choice.name,
        )
      ) {
        return false;
      }
    }
    this.reservation = { id, choice, epoch };
    return true;
  }

  play(id: number, wav: Uint8Array, durationMs: number): number | undefined {
    const reservation = this.reservation;
    // specs/OutputAdmission.tla, Play: an old generation cannot consume a new reservation.
    if (reservation === undefined || reservation.id !== id || reservation.epoch !== this.epoch) return undefined;
    this.reservation = undefined;
    if (!this.options.driver.available() || this.browser !== undefined) return undefined;
    if (reservation.choice.kind === 'default') {
      const pageId = this.options.defaultOutput.play(id, wav, durationMs);
      if (pageId !== undefined) this.browser = { id, pageId, retiring: false };
      return pageId;
    }
    const pageId = this.options.currentPage();
    if (pageId === undefined) return undefined;
    const active = { id, pageId, epoch: this.epoch };
    this.active = active;
    const accepted = this.options.driver.play(reservation.choice.name, wav, (event) => {
      queueMicrotask(() => {
        if (this.active !== active || active.epoch !== this.epoch) return;
        if (event !== 'started') this.active = undefined;
        this.options.audioEvent({ id, pageId, event });
      });
    });
    if (!accepted) {
      this.active = undefined;
      return undefined;
    }
    return pageId;
  }

  control(id: number, pageId: number, action: 'pause' | 'resume' | 'stop'): void {
    const active = this.active;
    if (active?.id === id && active.pageId === pageId) {
      if (action === 'stop') this.active = undefined;
      this.options.driver.control(action);
    } else {
      if (action === 'stop' && this.browser?.id === id && this.browser.pageId === pageId) this.browser.retiring = true;
      this.options.defaultOutput.control(id, pageId, action);
    }
  }

  status(id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string): void {
    this.options.defaultOutput.status(id, state, message);
  }

  localDiagnostic: SpeechOutput['localDiagnostic'] = (phase, reason) => {
    this.options.defaultOutput.localDiagnostic?.(phase, reason);
  };

  /** Accepts a retirement acknowledgement only for the requested stop. */
  browserRetired(id: number, pageId: number): void {
    // specs/OutputHandoff.tla, Ack: stale pages and units cannot release ownership.
    if (this.browser?.retiring === true && this.browser.id === id && this.browser.pageId === pageId) this.browser = undefined;
  }

  /** Releases browser ownership when the page has stopped or been disposed. */
  pageClosed(pageId: number): void {
    if (this.browser?.pageId === pageId) this.browser = undefined;
  }

  invalidate(): void {
    this.epoch++;
    this.reservation = undefined;
    if (this.active !== undefined) this.options.driver.control('stop');
    this.active = undefined;
  }
}
