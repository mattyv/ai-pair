import { LOCAL_AUDIO_VERSION, localAudioPrepared, type LocalAudioPrepared } from '@ai-pair/protocol';

/** The single panel owner chosen for this window. */
export type PanelOwner = 'companion' | 'legacy' | 'remote-text' | 'incompatible';

/** Safe categories for diagnosing failed preparation. */
export type PanelPrepareFailure =
  'timeout' | 'activation_timeout' | 'activation_failure' | 'invalid_response' | 'protocol_mismatch' | 'epoch_mismatch';

/** Inputs for bounded, two-phase companion attachment. */
export interface PanelPlacementOptions {
  epoch: string;
  remote: boolean;
  companionInstalled?: boolean;
  timeoutMs: number;
  activationTimeoutMs?: number;
  activate?: () => Promise<unknown>;
  prepare: () => Promise<unknown>;
  failure?: (reason: PanelPrepareFailure) => void;
  beforeCommit?: () => void;
  afterCommit?: () => void;
  commitFailed?: () => void;
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

  private failed(reason: PanelPrepareFailure): PanelOwner {
    this.options.failure?.(reason);
    return this.options.companionInstalled === true ? 'incompatible' : this.options.remote ? 'remote-text' : 'legacy';
  }

  /** Bounds preparation; a late answer cannot register or select a companion. */
  private async select(): Promise<PanelOwner> {
    // specs/PanelPlacement.tla, Activate: activation has a separate bounded deadline.
    if (this.options.activate !== undefined) {
      let activationTimer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol();
      const timeout = new Promise<symbol>((resolve) => {
        activationTimer = setTimeout(() => {
          resolve(timedOut);
        }, this.options.activationTimeoutMs ?? this.options.timeoutMs);
      });
      try {
        const activated = await Promise.race([Promise.resolve().then(this.options.activate), timeout]);
        if (activated === timedOut) return this.failed('activation_timeout');
        if (activated !== true) return this.failed('activation_failure');
      } catch {
        return this.failed('activation_failure');
      } finally {
        clearTimeout(activationTimer);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol();
    const timeout = new Promise<symbol>((resolve) => {
      timer = setTimeout(() => {
        resolve(timedOut);
      }, this.options.timeoutMs);
    });
    let answer: unknown;
    let failure: PanelPrepareFailure | undefined;
    try {
      answer = await Promise.race([Promise.resolve().then(this.options.prepare), timeout]);
    } catch {
      failure = 'activation_failure';
    } finally {
      clearTimeout(timer);
    }
    const prepared = localAudioPrepared.safeParse(answer);
    if (failure === undefined && answer === timedOut) failure = 'timeout';
    if (
      failure === undefined &&
      typeof answer === 'object' &&
      answer !== null &&
      'version' in answer &&
      answer.version !== LOCAL_AUDIO_VERSION
    ) {
      failure = 'protocol_mismatch';
    }
    if (failure !== undefined) return this.failed(failure);
    if (!prepared.success) return this.failed('invalid_response');
    if (prepared.data.epoch !== this.options.epoch) return this.failed('epoch_mismatch');
    // specs/PanelPlacement.tla, Commit: select companion before the registration command can run.
    try {
      this.options.beforeCommit?.();
    } catch {
      return 'companion';
    }
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const commitTimeout = new Promise<undefined>((resolve) => {
      commitTimer = setTimeout(() => {
        resolve(undefined);
      }, this.options.timeoutMs);
    });
    try {
      const accepted = await Promise.race([Promise.resolve().then(() => this.options.commit(prepared.data)), commitTimeout]);
      if (accepted === true) {
        // specs/PanelPlacement.tla, Acknowledged and StartSession: no session before acknowledgement.
        this.options.afterCommit?.();
      } else {
        this.options.commitFailed?.();
      }
    } catch {
      this.options.commitFailed?.();
    } finally {
      clearTimeout(commitTimer);
    }
    return 'companion';
  }
}
