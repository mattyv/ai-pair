/** Settings that determine whether completed speech can share context. */
export interface SpeechContextConfig {
  enabled: boolean;
  provider: string;
  model: string;
  voice: string;
}

/** A snapshot of earlier completed speech and its completion callbacks. */
export interface SpeechContextCapture {
  previousText?: string;
  complete(): void;
  cancel(): void;
}

const MAX_UTTERANCES = 3;
const MAX_CHARACTERS = 500;

/** Owns bounded, session-scoped completed speech history. */
export class SpeechContext {
  private identity: string | number | undefined;
  private active = false;
  private config: SpeechContextConfig | undefined;
  private history: string[] = [];
  private generation = 0;
  private current = 0;

  /** Resets history on an actual session transition, preserving replay. */
  session(identity: string | number, ongoing: boolean): void {
    // specs/SpeechContext.tla, Session and Reset.
    if (this.identity !== identity || this.active !== ongoing) this.reset();
    this.identity = identity;
    this.active = ongoing;
  }

  /** Resets history when any context-affecting setting changes. */
  configure(config: SpeechContextConfig): void {
    // specs/SpeechContext.tla, Configure and Toggle.
    if (
      this.config === undefined ||
      this.config.enabled !== config.enabled ||
      this.config.provider !== config.provider ||
      this.config.model !== config.model ||
      this.config.voice !== config.voice
    ) {
      this.reset();
    }
    this.config = { ...config };
  }

  /** Invalidates the session and all pending captures. */
  disconnect(): void {
    // specs/SpeechContext.tla, Reset.
    this.reset();
    this.identity = undefined;
    this.active = false;
  }

  /** Captures an immutable snapshot, accepted only once on current completion. */
  capture(text: string): SpeechContextCapture | undefined {
    // specs/SpeechContext.tla, Capture.
    if (!this.active || this.config?.enabled !== true) return undefined;
    const generation = this.generation;
    const current = ++this.current;
    const previousText = this.history.join(' ');
    let settled = false;
    return {
      ...(previousText === '' ? {} : { previousText }),
      complete: () => {
        // specs/SpeechContext.tla, Complete.
        if (settled || generation !== this.generation || current !== this.current) return;
        settled = true;
        this.history.push(Array.from(text).slice(-MAX_CHARACTERS).join(''));
        this.history = this.history.slice(-MAX_UTTERANCES);
        while (this.history.length > 1 && Array.from(this.history.join(' ')).length > MAX_CHARACTERS) this.history.shift();
      },
      cancel: () => {
        // specs/SpeechContext.tla, Cancel.
        settled = true;
      },
    };
  }

  private reset(): void {
    this.generation++;
    this.history = [];
  }
}
