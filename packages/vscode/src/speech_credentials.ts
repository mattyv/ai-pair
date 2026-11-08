/** Stores the ElevenLabs key only in VS Code SecretStorage. */
const KEY = 'aiPair.elevenLabs.apiKey';

interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** Handles a native password prompt and guards stale credential reads. */
export class SpeechCredentials {
  private epoch = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: SecretStore,
    private readonly prompt: () => PromiseLike<string | undefined>,
    private readonly changed: () => void,
  ) {}

  /** Reads a key for a host-side request only if no later change occurred. */
  async read(): Promise<string | undefined> {
    const epoch = this.epoch;
    await this.pending;
    const key = await this.storage.get(KEY);
    return epoch === this.epoch ? key : undefined;
  }

  /** Reports only key presence to UI callers. */
  async hasKey(): Promise<boolean> {
    return (await this.read()) !== undefined;
  }

  /** Prompts without prefilling, and stores a nonempty result. */
  async set(): Promise<void> {
    const epoch = this.epoch;
    const key = await this.prompt();
    if (key === undefined || key.length === 0 || epoch !== this.epoch) return;
    this.epoch++;
    this.changed();
    await this.mutate(() => this.storage.store(KEY, key));
  }

  /** Removes the stored key and invalidates pending reads and prompts. */
  async remove(): Promise<void> {
    this.epoch++;
    this.changed();
    await this.mutate(() => this.storage.delete(KEY));
  }

  /** Invalidates pending reads and prompts without changing the stored key. */
  supersede(): void {
    this.epoch++;
  }

  /** Invalidates reads and prompts after an external SecretStorage change. */
  invalidate(): void {
    this.epoch++;
    this.changed();
  }

  private async mutate(operation: () => PromiseLike<void>): Promise<void> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    await next;
  }
}
