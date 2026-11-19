/** How a stored setting reads, writes, and reports a failed write. */
export interface StoredSettingOptions<T> {
  /** Reads the value VS Code holds now. */
  read: () => T;
  /** Writes a value; in a remote window it crosses the remote link, and may take seconds. */
  write: (value: T) => PromiseLike<void>;
  /** Reports that the latest write failed, and why; the setting then reads the stored value again. */
  failed: (value: T, error: unknown) => void;
}

/** The latest requested value, until its write lands and the stored value shows it. */
interface Pending<T> {
  value: T;
  generation: number;
  landed: boolean;
}

/**
 * A setting the programmer changes from the panel, written to VS Code's settings (specs/SettingRoundTrip.tla,
 * #119). Until the latest write lands, it reads the requested value, so a page that loads meanwhile, or an
 * echoed change, never shows the old one (`ShowsChoice`); a failed latest write is reported (`NoSilentFailure`)
 * and the stored value read again (`SettledTruth`); and writes in flight can be awaited before a reload
 * (`NoLostWrite`).
 */
export class StoredSetting<T> {
  private pending?: Pending<T>;
  private generation = 0;
  private readonly writes = new Set<Promise<void>>();

  constructor(private readonly options: StoredSettingOptions<T>) {}

  /** Returns the requested value while its write is in flight, otherwise the stored one. */
  get(): T {
    const pending = this.pending;
    if (pending === undefined) return this.options.read();
    const stored = this.options.read();
    if (pending.landed && stored === pending.value) {
      this.pending = undefined;
      return stored;
    }
    return pending.value;
  }

  /** Requests a value and writes it; settles when the write lands or fails. */
  set(value: T): Promise<void> {
    const generation = ++this.generation;
    this.pending = { value, generation, landed: false };
    // The write starts now, so writes reach VS Code in the order they were requested; one that throws at once rejects.
    const started = new Promise<void>((resolve, reject) => {
      this.options.write(value).then(resolve, reject);
    });
    // specs/SettingRoundTrip.tla, Land and Fail: only the latest write decides what the setting reads.
    const write = started.then(
      () => {
        const pending = this.pending;
        if (pending?.generation !== generation) return;
        if (this.options.read() === value) this.pending = undefined;
        else pending.landed = true;
      },
      (error: unknown) => {
        if (this.pending?.generation !== generation) return;
        this.pending = undefined;
        this.options.failed(value, error);
      },
    );
    this.writes.add(write);
    return write.finally(() => {
      this.writes.delete(write);
    });
  }

  /** Notes that VS Code reported a change: a write that landed is now in the stored value. */
  changed(): void {
    if (this.pending?.landed === true) this.pending = undefined;
  }

  /** Reports whether a write is in flight. */
  busy(): boolean {
    return this.writes.size > 0;
  }

  /** Settles once every write in flight has landed or failed. */
  settled(): Promise<void> {
    return Promise.all(this.writes).then(() => {});
  }
}

/** A setting whose writes in flight can be awaited, whatever its value's type. */
export interface Settling {
  busy(): boolean;
  settled(): Promise<void>;
}

/** Waits, before a reload, for the settings' writes in flight, but no longer than `timeoutMs` (specs/SettingRoundTrip.tla, Reload). */
export function settleWithin(settings: readonly Settling[], timeoutMs: number): Promise<void> {
  const busy = settings.filter((setting) => setting.busy());
  if (busy.length === 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race<unknown>([Promise.all(busy.map((setting) => setting.settled())), bound])
    .then(() => {})
    .finally(() => {
      clearTimeout(timer);
    });
}
