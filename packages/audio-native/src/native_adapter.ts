import {
  MAX_AUDIO_PARTS,
  type AudioAdapter,
  type AudioCapabilities,
  type AudioChoice,
  type AudioDevice,
  type AudioEvent,
  type AudioLease,
  type AudioOwner,
} from './index';
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
interface Part {
  ordinal: number;
  started: boolean;
  terminal?: Exclude<Outcome, 'started'>;
}
interface Job {
  owner: AudioOwner;
  lease: AudioLease;
  nextPart: number;
  failed: boolean;
  pauseEpoch: number;
  part?: Part;
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
      this.job = { owner: pending.owner, lease, nextPart: 0, failed: false, pauseEpoch: 0, paused: pending.paused };
      return lease;
    } catch {
      if (this.pending === pending) this.pending = undefined;
      throw new Error('Audio output is unavailable.');
    }
  }
  async play(lease: AudioLease, wav: Uint8Array, ordinal = 0): Promise<void> {
    const job = this.job;
    if (
      !job ||
      job.lease !== lease ||
      job.part !== undefined ||
      job.stopping !== undefined ||
      job.failed ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= MAX_AUDIO_PARTS ||
      ordinal !== job.nextPart ||
      wav.length < MIN_WAV ||
      wav.length > MAX_WAV
    ) {
      throw new Error('Audio output is unavailable.');
    }
    const part: Part = { ordinal, started: false };
    job.part = part;
    let route: string;
    for (;;) {
      const pausedAtCheck = job.paused;
      const pauseEpoch = job.pauseEpoch;
      const checked = await this.admission.recheck(lease);
      if (checked === undefined || this.job !== job || job.part !== part || job.stopping !== undefined) {
        throw new Error('Audio output is unavailable.');
      }
      if (!job.paused && !pausedAtCheck && pauseEpoch === job.pauseEpoch) {
        route = checked;
        break;
      }
      if (job.paused) {
        await new Promise<void>((resolve) => {
          job.wake = resolve;
        });
      }
      if (this.job !== job || job.part !== part || job.stopping !== undefined) throw new Error('Audio output is unavailable.');
    }
    const process = this.backend.start(route, wav, (type) => {
      if (this.job !== job || job.part !== part || job.stopping !== undefined) return;
      if (type !== 'started') {
        part.terminal ??= type;
      } else if (part.terminal === undefined && !part.started) {
        part.started = true;
        queueMicrotask(() => {
          if (this.job === job && job.part === part && job.stopping === undefined) {
            this.emit(job, part, 'started');
          }
        });
      }
    });
    if (!this.playback.attach(job.owner, process)) {
      process.stop();
      throw new Error('Audio output is busy.');
    }
    job.process = process;
    void this.playback.wait(job.owner).then(() => {
      if (this.job !== job || job.part !== part || job.stopping !== undefined) return;
      job.part = undefined;
      job.process = undefined;
      const outcome = part.terminal === 'ended' && part.started ? 'ended' : part.terminal === 'canceled' ? 'canceled' : 'failed';
      if (outcome === 'ended') job.nextPart++;
      else job.failed = true;
      this.emit(job, part, outcome);
    });
  }

  private emit(job: Job, part: Part, type: Outcome): void {
    const event: AudioEvent = { owner: { ...job.owner }, sequence: this.sequence++, part: part.ordinal, type };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* An observer cannot disrupt ownership. */
      }
    }
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
      this.job = undefined;
    });
    return job.stopping;
  }
  pause(owner: AudioOwner): Promise<void> {
    if (this.pending && sameOwner(this.pending.owner, owner)) this.pending.paused = true;
    const job = this.job;
    if (job && sameOwner(job.owner, owner) && !job.paused) {
      job.paused = true;
      job.pauseEpoch++;
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
