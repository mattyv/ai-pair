import { localAudioPrepared, type LocalAudioPrepared } from '@ai-pair/protocol';

/** The single panel owner chosen for this window. */
export type PanelOwner = 'companion' | 'legacy' | 'remote-text';

/** Inputs for bounded, two-phase companion attachment. */
export interface PanelPlacementOptions {
  epoch: string;
  remote: boolean;
  timeoutMs: number;
  prepare: () => Promise<unknown>;
  beforeCommit?: () => void;
  commit: (prepared: LocalAudioPrepared) => Promise<unknown>;
}

/** Chooses a panel owner once, without falling back after companion commit. */
export class PanelPlacement {
  private selection?: Promise<PanelOwner>;

  constructor(private readonly options: PanelPlacementOptions) {}

  /** Returns the same ownership decision for the lifetime of this window. */
  choose(): Promise<PanelOwner> {
    this.selection ??= this.select();
    return this.selection;
  }

  /** Bounds preparation; a late answer cannot register or select a companion. */
  private async select(): Promise<PanelOwner> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, this.options.timeoutMs);
    });
    let answer: unknown;
    try {
      answer = await Promise.race([Promise.resolve().then(this.options.prepare), timeout]);
    } catch {
      answer = undefined;
    } finally {
      clearTimeout(timer);
    }
    const prepared = localAudioPrepared.safeParse(answer);
    if (!prepared.success || prepared.data.epoch !== this.options.epoch) {
      return this.options.remote ? 'remote-text' : 'legacy';
    }
    // specs/PanelPlacement.tla, Commit: select companion before the registration command can run.
    try {
      this.options.beforeCommit?.();
    } catch {
      return 'companion';
    }
    void Promise.resolve()
      .then(() => this.options.commit(prepared.data))
      .catch(() => {});
    return 'companion';
  }
}
