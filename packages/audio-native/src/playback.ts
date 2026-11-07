import type { AudioOwner } from './index';

interface ProcessHandle {
  stop(): void;
  /** Resolves only once the operating system has closed the child process. */
  closed: Promise<void>;
}
interface PhysicalJob {
  owner: AudioOwner;
  process: ProcessHandle;
  stopped: boolean;
  retired: Promise<void>;
}

/** The output slot remains occupied until the actual child close notification. */
export class PhysicalPlayback {
  private current?: PhysicalJob;

  attach(owner: AudioOwner, process: ProcessHandle): boolean {
    if (this.current) return false;
    const job: PhysicalJob = { owner: { ...owner }, process, stopped: false, retired: Promise.resolve() };
    this.current = job;
    job.retired = process.closed.then(
      () => {
        this.current = undefined;
      },
      () => Promise.withResolvers<void>().promise,
    );
    return true;
  }

  wait(owner: AudioOwner): Promise<void> {
    const job = this.current;
    if (
      !job ||
      job.owner.connectionEpoch !== owner.connectionEpoch ||
      job.owner.jobId !== owner.jobId ||
      job.owner.pageEpoch !== owner.pageEpoch
    ) {
      return Promise.resolve();
    }
    return job.retired;
  }

  stop(owner: AudioOwner): Promise<void> {
    const job = this.current;
    if (
      !job ||
      job.owner.connectionEpoch !== owner.connectionEpoch ||
      job.owner.jobId !== owner.jobId ||
      job.owner.pageEpoch !== owner.pageEpoch
    ) {
      return Promise.resolve();
    }
    if (!job.stopped) {
      try {
        job.process.stop();
        job.stopped = true;
      } catch {
        // Keep ownership and allow a later stop attempt; only close can release it.
      }
    }
    return job.retired;
  }
}
