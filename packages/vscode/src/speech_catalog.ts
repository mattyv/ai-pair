import type { SpeechDiagnosticReason } from './diagnostics';

/** The nonsecret voice data shown in Settings. */
export interface CatalogVoice {
  id: string;
  name: string;
  category?: string;
}

/** A bounded account voice page, already validated by the provider client. */
interface VoicePage {
  voices: CatalogVoice[];
  nextCursor?: string;
}

/** The nonsecret state rendered by the webview. */
export interface CatalogView {
  voices: CatalogVoice[];
  more: boolean;
  loading: boolean;
  error: boolean;
  errorKind?: SpeechDiagnosticReason;
  reset?: true;
}

const MAX_VOICES = 500;

/** Owns explicit catalog requests and invalidates stale responses. */
export class SpeechCatalog {
  private epoch = 0;
  private abort?: AbortController;
  private voices: CatalogVoice[] = [];
  private next?: string;
  private readonly cursors = new Set<string>();

  constructor(
    private readonly client: { voices(cursor: string | undefined, signal: AbortSignal): Promise<VoicePage> },
    private readonly publish: (view: CatalogView) => void,
  ) {}

  /** Checks whether a selected ID came from the current account catalog. */
  contains(id: string): boolean {
    return this.voices.some((voice) => voice.id === id);
  }

  /** Clears results and aborts a request after a key, provider or page change. */
  invalidate(): void {
    this.epoch++;
    this.abort?.abort();
    this.abort = undefined;
    this.voices = [];
    this.next = undefined;
    this.cursors.clear();
    this.publish({ voices: [], more: false, loading: false, error: false, reset: true });
  }

  /** Loads the first page or the next page only on explicit request. */
  async load(more: boolean): Promise<void> {
    if (more && this.next === undefined) return;
    this.abort?.abort();
    const epoch = ++this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    if (!more) {
      this.voices = [];
      this.next = undefined;
      this.cursors.clear();
    }
    const cursor = more ? this.next : undefined;
    this.publish({ voices: this.voices, more: false, loading: true, error: false });
    try {
      const page = await this.client.voices(cursor, abort.signal);
      if (epoch !== this.epoch) return;
      this.voices = [...this.voices, ...page.voices].slice(0, MAX_VOICES);
      const next = page.nextCursor;
      this.next = next !== undefined && !this.cursors.has(next) && this.voices.length < MAX_VOICES ? next : undefined;
      if (next !== undefined) this.cursors.add(next);
      this.publish({ voices: this.voices, more: this.next !== undefined, loading: false, error: false });
    } catch (error: unknown) {
      if (epoch !== this.epoch) return;
      const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined;
      const errorKind: SpeechDiagnosticReason =
        kind === 'key'
          ? 'no_key'
          : kind === 'auth' || kind === 'rate' || kind === 'network' || kind === 'timeout' || kind === 'invalid' || kind === 'canceled'
            ? kind
            : 'unknown';
      this.publish({ voices: this.voices, more: false, loading: false, error: true, errorKind });
    }
  }
}
