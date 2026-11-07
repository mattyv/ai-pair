import type { OutputCatalog, OutputChoice } from './speech_output_types';

/** A catalog with a fixed, non-sensitive persistence error. */
export type OutputPreferenceView = OutputCatalog & { error?: 'save_failed' };

/** The local preference's collaborators. */
export interface OutputPreferenceWiring {
  initial: unknown;
  write: (choice: OutputChoice) => Promise<void>;
  stop: () => void;
  changed: (view: OutputPreferenceView) => void;
  discover: () => Promise<Omit<OutputCatalog, 'selected'>>;
}

const MAX_OUTPUT_NAME_LENGTH = 256;
const FIRST_CONTROL_END = 31;
const DELETE_CHARACTER = 127;

/** Returns a validated local choice, with no untrusted extra properties. */
function parseChoice(value: unknown): OutputChoice | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if ('kind' in value && value.kind === 'default') return { kind: 'default' };
  if (
    'kind' in value &&
    value.kind === 'native' &&
    'backend' in value &&
    'name' in value &&
    value.backend === 'pipewire' &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= MAX_OUTPUT_NAME_LENGTH &&
    !Array.from(value.name).some((character) => {
      const code = Number(character.codePointAt(0));
      return code <= FIRST_CONTROL_END || code === DELETE_CHARACTER;
    })
  ) {
    return { kind: 'native', backend: value.backend, name: value.name };
  }
  return undefined;
}

/** Keeps local output selection immediate and serializes persistence. */
export class SpeechOutputPreferences {
  private selected: OutputChoice;
  private stored: OutputChoice;
  private catalog: Omit<OutputCatalog, 'selected'> = { supported: false, devices: [] };
  private sequence = 0;
  private refreshSequence = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly wiring: OutputPreferenceWiring) {
    this.selected = parseChoice(wiring.initial) ?? { kind: 'default' };
    this.stored = this.selected;
  }

  /** Returns the current choice. */
  choice(): OutputChoice {
    return this.selected;
  }

  /** Returns whether the current choice is available without starting discovery. */
  ready(): boolean {
    const selected = this.selected;
    return (
      selected.kind === 'default' ||
      (this.catalog.supported &&
        this.catalog.devices.some(
          (device) => device.available && device.choice.backend === selected.backend && device.choice.name === selected.name,
        ))
    );
  }

  /** Returns the current local catalog without starting discovery. */
  view(): OutputPreferenceView {
    return { ...this.catalog, selected: this.selected };
  }

  /** Selects an available choice, stopping playback before the route changes. */
  choose(choice: unknown): Promise<void> {
    const parsed = parseChoice(choice);
    if (
      parsed === undefined ||
      (parsed.kind === 'native' &&
        (!this.catalog.supported ||
          !this.catalog.devices.some(
            (device) => device.available && device.choice.backend === parsed.backend && device.choice.name === parsed.name,
          )))
    ) {
      this.notify();
      return Promise.resolve();
    }
    // specs/OutputPreference.tla, Select: stop before changing the selected route.
    this.wiring.stop();
    this.selected = parsed;
    const requested = this.selected;
    const sequence = ++this.sequence;
    this.notify();
    const commit = this.tail.then(async () => {
      try {
        await this.wiring.write(requested);
        this.stored = requested;
      } catch {
        if (sequence === this.sequence) {
          // specs/OutputPreference.tla, WriteFailed: stop before a latest rollback.
          this.wiring.stop();
          this.selected = this.stored;
          this.notify('save_failed');
        }
      }
    });
    this.tail = commit;
    return commit;
  }

  /** Refreshes the catalog, ignoring results superseded by a newer refresh. */
  async refresh(): Promise<void> {
    // specs/OutputPreference.tla, Refresh and Complete: only the latest result applies.
    const sequence = ++this.refreshSequence;
    try {
      const catalog = await this.wiring.discover();
      if (sequence !== this.refreshSequence) return;
      this.catalog = catalog;
    } catch {
      if (sequence !== this.refreshSequence) return;
      this.catalog = { supported: false, devices: [], reason: 'unavailable' };
    }
    this.notify();
  }

  private notify(error?: 'save_failed'): void {
    this.wiring.changed({ ...this.catalog, selected: this.selected, ...(error === undefined ? {} : { error }) });
  }
}
