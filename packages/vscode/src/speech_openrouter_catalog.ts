import type { OpenRouterModel, OpenRouterSpeechPort } from './speech_types';

/** Nonsecret catalog state presented to the settings panel. */
export interface OpenRouterCatalogView {
  state: 'idle' | 'loading' | 'ready' | 'error';
  verified: boolean;
  models: OpenRouterModel[];
  message?: string;
}

/** Owns catalog requests and discards replies from invalidated settings. */
export class OpenRouterCatalog {
  private epoch = 0;
  private abort?: AbortController;
  private models: OpenRouterModel[] = [];
  private evidence: 'unknown' | 'ready' = 'unknown';

  constructor(
    private readonly client: Pick<OpenRouterSpeechPort, 'models'>,
    private readonly publish: (view: OpenRouterCatalogView) => void,
  ) {}

  /** Checks that a voice belongs to an accessible current model. */
  contains(model: string, voice: string): boolean {
    return this.models.some((item) => item.id === model && (voice === '' || item.voices.some((candidate) => candidate.id === voice)));
  }

  /** Allows remembered choices until a current catalog proves them unavailable. */
  allows(model: string, voice: string): boolean {
    // specs/OpenRouterCatalog.tla, Admit: unknown permits a remembered pair; current denial blocks it.
    return this.evidence === 'unknown' || this.contains(model, voice);
  }

  /** Aborts pending work and clears its results. */
  invalidate(): void {
    // specs/OpenRouterCatalog.tla, Reset: invalidate the old identity and its pending response.
    this.epoch++;
    this.abort?.abort();
    this.abort = undefined;
    this.models = [];
    this.evidence = 'unknown';
    this.publish({ state: 'idle', verified: false, models: [] });
  }

  /** Loads the current account catalog under the selected policy. */
  async load(zdr: boolean): Promise<void> {
    // specs/OpenRouterCatalog.tla, Load: a refresh preserves existing eligibility evidence.
    this.abort?.abort();
    const epoch = ++this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ state: 'loading', verified: this.evidence === 'ready', models: this.models });
    try {
      const models = await this.client.models(zdr, abort.signal);
      // specs/OpenRouterCatalog.tla, Reply: only a current response updates evidence.
      if (epoch !== this.epoch) return;
      this.models = models;
      this.evidence = 'ready';
      this.publish({ state: 'ready', verified: true, models });
    } catch {
      if (epoch !== this.epoch) return;
      this.publish({
        state: 'error',
        verified: this.evidence === 'ready',
        models: this.models,
        message: 'Could not load OpenRouter models. Check your key and account access.',
      });
    }
  }
}
