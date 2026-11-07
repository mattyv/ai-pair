import type { AudioAdapter, AudioCapabilities, AudioChoice, AudioDevice, AudioEvent, AudioLease, AudioOwner } from './index';
import { AudioAdmission } from './admission';
import { PhysicalPlayback } from './playback';

type Outcome = AudioEvent['type'];
interface ProcessHandle {
  stop(): void;
  closed: Promise<void>;
  pause?(): void;
  resume?(): void;
}
interface Backend {
  list(): Promise<AudioDevice[]>;
  defaultId?(): Promise<string | undefined>;
  capabilities?(): Promise<AudioCapabilities>;
  /** Returns ownership of a launched process synchronously; throws only before launch. */
  start(route: string, wav: Uint8Array, event: (type: Outcome) => void): ProcessHandle;
}
interface Job {
  owner: AudioOwner;
  lease: AudioLease;
  started: boolean;
  paused: boolean;
  wake?: () => void;
  process?: ProcessHandle;
  stopping?: Promise<void>;
}
const MIN_WAV = 44;
const MAX_WAV = 1_948_844;

function sameOwner(a: AudioOwner, b: AudioOwner): boolean {
  return a.connectionEpoch === b.connectionEpoch && a.jobId === b.jobId && a.pageEpoch === b.pageEpoch;
}

/** Coordinates logical route admission with exclusive physical process retirement. */
export class NativeAdapter implements AudioAdapter {
  private readonly admission: AudioAdmission;
  private readonly playback = new PhysicalPlayback();
  private readonly listeners = new Set<(event: AudioEvent) => void>();
  private job?: Job;
  private pending?: { owner: AudioOwner; paused: boolean };
  private sequence = 1;

  constructor(private readonly backend: Backend) {
    this.admission = new AudioAdmission(backend);
  }

  capabilities(): Promise<AudioCapabilities> {
    return (
      this.backend.capabilities?.() ??
      Promise.resolve({ backend: 'unavailable', location: 'ui', defaultOutput: false, deviceSelection: false, pauseResume: false })
    );
  }
  list(): Promise<AudioDevice[]> {
    return this.backend.list();
  }
  async admit(owner: AudioOwner, choice: AudioChoice): Promise<AudioLease> {
    if (this.pending || this.job) throw new Error('Audio output is busy.');
    const pending = { owner: { ...owner }, paused: false };
    this.pending = pending;
    try {
      const lease = await this.admission.admit(pending.owner, choice);
      if (this.pending !== pending || this.admission.route(lease) === undefined) throw new Error('Audio output is unavailable.');
      this.pending = undefined;
      this.job = { owner: pending.owner, lease, started: false, paused: pending.paused };
      return lease;
    } catch {
      if (this.pending === pending) this.pending = undefined;
      throw new Error('Audio output is unavailable.');
    }
  }
  async play(lease: AudioLease, wav: Uint8Array): Promise<void> {
    const job = this.job;
    if (!job || job.lease !== lease || job.started || wav.length < MIN_WAV || wav.length > MAX_WAV) {
      throw new Error('Audio output is unavailable.');
    }
    job.started = true;
    const route = await this.admission.recheck(lease);
    if (route === undefined || this.job !== job || job.stopping !== undefined) throw new Error('Audio output is unavailable.');
    while (job.paused && this.job === job && job.stopping === undefined) {
      await new Promise<void>((resolve) => {
        job.wake = resolve;
      });
    }
    if (this.job !== job || job.stopping !== undefined) throw new Error('Audio output is unavailable.');
    const process = this.backend.start(route, wav, (type) => {
      queueMicrotask(() => {
        if (this.job !== job) return;
        const event: AudioEvent = { owner: { ...job.owner }, sequence: this.sequence++, type };
        for (const listener of this.listeners) listener(event);
      });
    });
    if (!this.playback.attach(job.owner, process)) {
      process.stop();
      throw new Error('Audio output is busy.');
    }
    job.process = process;
    void this.playback.wait(job.owner).then(() => {
      if (this.job === job) {
        void this.admission.stop(job.owner);
        this.job = undefined;
      }
    });
  }
  stop(owner: AudioOwner): Promise<void> {
    const job = this.job;
    if (!job && this.pending && sameOwner(this.pending.owner, owner)) this.pending = undefined;
    if (
      !job ||
      job.owner.connectionEpoch !== owner.connectionEpoch ||
      job.owner.jobId !== owner.jobId ||
      job.owner.pageEpoch !== owner.pageEpoch
    ) {
      return this.admission.stop(owner);
    }
    job.wake?.();
    job.stopping ??= this.playback.stop(job.owner).then(async () => {
      await this.admission.stop(job.owner);
      if (this.job === job) this.job = undefined;
    });
    return job.stopping;
  }
  pause(owner: AudioOwner): Promise<void> {
    if (this.pending && sameOwner(this.pending.owner, owner)) this.pending.paused = true;
    const job = this.job;
    if (job && sameOwner(job.owner, owner) && !job.paused) {
      job.paused = true;
      job.process?.pause?.();
    }
    return Promise.resolve();
  }
  resume(owner: AudioOwner): Promise<void> {
    if (this.pending && sameOwner(this.pending.owner, owner)) this.pending.paused = false;
    const job = this.job;
    if (job && sameOwner(job.owner, owner) && job.paused) {
      job.paused = false;
      job.process?.resume?.();
      job.wake?.();
      job.wake = undefined;
    }
    return Promise.resolve();
  }
  onEvent(listener: (event: AudioEvent) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }
}
