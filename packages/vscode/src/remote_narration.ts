import type { NarrationPort } from '@ai-pair/core';
import { LOCAL_AUDIO_VERSION, localAudioFrame, speechProblem, type LocalAudioFrame } from '@ai-pair/protocol';

/** Maximum wait for a previous physical owner after logical settlement. */
const RETIREMENT_TIMEOUT_MS = 3000;

/** Dependencies of the workspace-side narration command proxy. */
export interface RemoteNarrationOptions {
  epoch: string;
  page: () => number | undefined;
  timeoutMs: number;
  send: (frame: LocalAudioFrame) => void;
  nextSequence: () => number;
}

interface Job {
  id: string;
  page: number;
  resolve: () => void;
  waiters: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  deadline: number;
  remaining: number;
  paused: boolean;
  settled: boolean;
}

/** Proxies a single narration unit while preserving remote retirement ownership. */
export class RemoteNarration implements NarrationPort {
  private ackSequence = 0;
  private nextJob = 0;
  private current?: Job;
  private closed = false;

  constructor(private readonly options: RemoteNarrationOptions) {}

  /** Sends one bounded narration and waits for its matching terminal acknowledgement. */
  speak(text: string, delivery?: import('@ai-pair/protocol').SpeechDelivery): Promise<void> {
    if (speechProblem(text) !== undefined) return Promise.resolve();
    return this.start({ type: 'speak', text, ...(delivery === undefined ? {} : { delivery }) });
  }

  /** Sends an attention cue through the same owned remote job. */
  attentionCue(): Promise<void> {
    return this.start({ type: 'attentionCue' });
  }

  /** Reserves the remote output until the matching acknowledgement. */
  private start(
    action: { type: 'speak'; text: string; delivery?: import('@ai-pair/protocol').SpeechDelivery } | { type: 'attentionCue' },
  ): Promise<void> {
    const page = this.options.page();
    if (this.closed || this.current !== undefined || page === undefined) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const job: Job = {
      id: String(++this.nextJob),
      page,
      resolve,
      waiters: new Set(),
      settled: false,
      paused: false,
      deadline: 0,
      remaining: this.options.timeoutMs,
    };
    this.current = job;
    this.arm(job);
    // specs/RemoteCue.tla, `Send`: keep the slot until its terminal acknowledgement.
    this.send({ ...this.envelope(), ...action, jobId: job.id, pageEpoch: page });
    return promise;
  }

  /** Applies a matching, ordered terminal acknowledgement. */
  ack(value: unknown): boolean {
    const parsed = localAudioFrame.safeParse(value);
    const job = this.current;
    if (!parsed.success || parsed.data.type !== 'terminal' || job === undefined || this.closed) return false;
    const frame = parsed.data;
    if (
      frame.connectionEpoch !== this.options.epoch ||
      frame.sequence <= this.ackSequence ||
      frame.jobId !== job.id ||
      frame.pageEpoch !== job.page
    ) {
      return false;
    }
    // specs/LocalAudioOwnership.tla, Ack: stale jobs, pages and connections cannot release the slot.
    this.ackSequence = frame.sequence;
    this.current = undefined;
    for (const waiter of job.waiters) waiter();
    clearTimeout(job.timer);
    this.settle(job);
    return true;
  }

  /** Waits boundedly for the matching terminal acknowledgement without queuing text. */
  waitForRetirement(signal: AbortSignal): Promise<boolean> {
    const job = this.current;
    if (this.closed || signal.aborted) return Promise.resolve(false);
    if (job === undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const waiter = {
        finish: (ready: boolean): void => {
          clearTimeout(timer);
          signal.removeEventListener('abort', waiter.abort);
          job.waiters.delete(waiter.retired);
          resolve(ready);
        },
        retired: (): void => {
          waiter.finish(!this.closed);
        },
        abort: (): void => {
          waiter.finish(false);
        },
      };
      timer = setTimeout(waiter.abort, RETIREMENT_TIMEOUT_MS);
      job.waiters.add(waiter.retired);
      signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }

  /** Pauses only the current unit. */
  pause(): void {
    const job = this.current;
    if (job === undefined || job.settled || job.paused) return;
    job.paused = true;
    job.remaining = Math.max(0, job.deadline - Date.now());
    clearTimeout(job.timer);
    this.sendControl(job, 'pause');
  }

  /** Resumes only the current unit. */
  resume(): void {
    const job = this.current;
    if (job === undefined || job.settled || !job.paused) return;
    job.paused = false;
    this.arm(job);
    this.sendControl(job, 'resume');
  }

  /** Settles the caller but retains the slot until a terminal acknowledgement. */
  cancel(): void {
    const job = this.current;
    if (job === undefined || job.settled) return;
    this.sendControl(job, 'cancel');
    clearTimeout(job.timer);
    this.settle(job);
  }

  /** Ends this connection and settles a waiting caller. */
  dispose(): void {
    this.cancel();
    this.closed = true;
    for (const waiter of this.current?.waiters ?? []) waiter();
  }

  /** Arms only the remaining unpaused terminal-acknowledgement budget. */
  private arm(job: Job): void {
    job.deadline = Date.now() + job.remaining;
    job.timer = setTimeout(() => {
      if (this.current !== job || job.paused) return;
      this.sendControl(job, 'cancel');
      this.settle(job);
    }, job.remaining);
  }

  /** Produces a fresh sequence in the outbound direction. */
  private envelope(): { version: typeof LOCAL_AUDIO_VERSION; connectionEpoch: string; sequence: number } {
    return { version: LOCAL_AUDIO_VERSION, connectionEpoch: this.options.epoch, sequence: this.options.nextSequence() };
  }

  /** Sends a fixed control scoped to the current page and job. */
  private sendControl(job: Job, type: 'pause' | 'resume' | 'cancel'): void {
    this.send({ ...this.envelope(), type, jobId: job.id, pageEpoch: job.page });
  }

  /** Hides transport failures; the timeout still settles the caller safely. */
  private send(frame: LocalAudioFrame): void {
    try {
      this.options.send(frame);
    } catch {
      // A failed send cannot be distinguished from a lost acknowledgement.
    }
  }

  /** Resolves a caller at most once without releasing physical ownership. */
  private settle(job: Job): void {
    if (job.settled) return;
    job.settled = true;
    job.resolve();
  }
}
