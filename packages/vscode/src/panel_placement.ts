import { LOCAL_AUDIO_VERSION, localAudioPrepared, type LocalAudioFailure, type LocalAudioPrepared } from '@ai-pair/protocol';

/** The single panel owner chosen for this window. */
export type PanelOwner = 'companion' | 'legacy' | 'remote-text' | 'incompatible';

/** Safe categories for diagnosing failed preparation. */
export type PanelPrepareFailure = LocalAudioFailure;

/** How long to wait before asking again for a companion the window does not know of yet. */
const DISCOVERY_RETRY_MS = 250;

/** Inputs for bounded, two-phase companion attachment. */
export interface PanelPlacementOptions {
  epoch: string;
  remote: boolean;
  companionInstalled?: boolean;
  timeoutMs: number;
  activationTimeoutMs?: number;
  activate?: () => Promise<unknown>;
  /** The wait between activation attempts that did not find the companion. */
  retryMs?: number;
  prepare: () => Promise<unknown>;
  failure?: (reason: PanelPrepareFailure) => void;
  /** Receives the companion's version once its preparation is valid. */
  prepared?: (extension: string) => void;
  beforeCommit?: () => void;
  afterCommit?: () => void;
  commitFailed?: () => void;
  commit: (prepared: LocalAudioPrepared) => Promise<unknown>;
}

/** Chooses a panel owner once, without falling back after companion commit. */
export class PanelPlacement {
  private selection?: Promise<PanelOwner>;
  /** An activation attempt found the companion, so it is installed. */
  private reached = false;

  constructor(private readonly options: PanelPlacementOptions) {}

  /** Returns the same ownership decision for the lifetime of this window. */
  choose(): Promise<PanelOwner> {
    this.selection ??= this.select();
    return this.selection;
  }

  private failed(reason: PanelPrepareFailure): PanelOwner {
    this.options.failure?.(reason);
    // specs/PanelPlacement.tla, NoMissingOnceReached: a companion that answered is installed, so it is not reported missing.
    if (this.options.companionInstalled === true || this.reached) return 'incompatible';
    return this.options.remote ? 'remote-text' : 'legacy';
  }

  /**
   * Activates the companion within the activation deadline. A rejected attempt means its command is not
   * registered yet: in a remote window the companion's extension host may register it after this one
   * starts, so it is asked again until the deadline (specs/PanelPlacement.tla, Appear and
   * ExpireBeforeCommit; #115). An attempt still pending at the deadline found the command, so it times out.
   */
  private async activate(activate: () => Promise<unknown>): Promise<'found' | PanelPrepareFailure> {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    /** Resolves to the value after the wait, on a timer cleared once activation settles. */
    function after<T>(ms: number, value: T): Promise<T> {
      return new Promise((resolve) => {
        timers.push(
          setTimeout(() => {
            resolve(value);
          }, ms),
        );
      });
    }
    const timedOut = Symbol();
    const deadline = after(this.options.activationTimeoutMs ?? this.options.timeoutMs, timedOut);
    try {
      for (;;) {
        let rejected = false;
        const attempt = Promise.resolve()
          .then(activate)
          .catch(() => {
            rejected = true;
          });
        const activated = await Promise.race([attempt, deadline]);
        if (activated === timedOut) return 'activation_timeout';
        if (!rejected) return activated === true ? 'found' : 'activation_failure';
        // A companion this host lists is installed: its rejection is a failure to start, not a late registration.
        if (this.options.companionInstalled === true) return 'activation_failure';
        if ((await Promise.race([after(this.options.retryMs ?? DISCOVERY_RETRY_MS, undefined), deadline])) === timedOut) {
          return 'not_found';
        }
      }
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
  }

  /** Bounds preparation; a late answer cannot register or select a companion. */
  private async select(): Promise<PanelOwner> {
    // specs/PanelPlacement.tla, Activate: activation has a separate bounded deadline.
    if (this.options.activate !== undefined) {
      const activated = await this.activate(this.options.activate);
      // specs/PanelPlacement.tla, Prepare: only a companion never found can be reported missing.
      if (activated !== 'not_found') this.reached = true;
      if (activated !== 'found') return this.failed(activated);
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
    this.options.prepared?.(prepared.data.extension);
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
