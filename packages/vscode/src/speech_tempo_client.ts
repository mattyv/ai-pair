import { Worker } from 'node:worker_threads';
import { TEMPO_REQUEST, TEMPO_RESPONSE } from './speech_tempo_messages';
import type { SpeechTempoRate } from './speech_tempo';

/** A bounded local transform owned by one narration unit and part. */
export interface SpeechTempoTransform {
  unitId: number;
  part: number;
  rate: SpeechTempoRate;
  pcm: Int16Array;
}

interface Job {
  worker: Worker;
  epoch: number;
  input: SpeechTempoTransform;
  signal: AbortSignal;
  abort: () => void;
  resolve: (value: Int16Array) => void;
  reject: (error: Error) => void;
  retired: Promise<void>;
  retireResolve: () => void;
  timer?: ReturnType<typeof setTimeout>;
  result?: Int16Array;
  settled: boolean;
  retiring: boolean;
}

/** Independent deadline for one tempo worker and its physical retirement. */
export const SPEECH_TEMPO_TIMEOUT_MS = 30_000;

/** Owns one local tempo worker until its physical exit or termination. */
export class SpeechTempoClient {
  private epoch = 0;
  private current?: Job;
  private disposed = false;

  constructor(private readonly workerPath: string) {}

  /** Reports whether a transform, even a retiring one, still owns the worker slot. */
  busy(): boolean {
    return this.current !== undefined;
  }

  /** Transforms a copied PCM buffer under a fixed unit, part and rate. */
  transform(input: SpeechTempoTransform, signal: AbortSignal): Promise<Int16Array> {
    if (this.disposed || this.current !== undefined || signal.aborted) return Promise.reject(new Error('Speech transform unavailable.'));
    const epoch = ++this.epoch;
    const parsed = TEMPO_REQUEST.safeParse({
      type: 'transform',
      epoch,
      unitId: input.unitId,
      part: input.part,
      rate: input.rate,
      pcm: input.pcm,
    });
    if (!parsed.success) return Promise.reject(new Error('Speech transform unavailable.'));
    const pcm = new Int16Array(parsed.data.pcm);
    const request = { ...parsed.data, pcm };
    let worker: Worker;
    try {
      worker = new Worker(this.workerPath);
    } catch {
      return Promise.reject(new Error('Speech transform unavailable.'));
    }
    const result = Promise.withResolvers<Int16Array>();
    const retired = Promise.withResolvers<void>();
    const job: Job = {
      worker,
      epoch,
      input: { unitId: input.unitId, part: input.part, rate: input.rate, pcm },
      signal,
      resolve: result.resolve,
      reject: result.reject,
      retired: retired.promise,
      retireResolve: retired.resolve,
      settled: false,
      retiring: false,
      abort: () => {
        this.fail(job);
      },
    };
    this.current = job;
    signal.addEventListener('abort', job.abort, { once: true });
    worker.on('message', (value: unknown) => {
      this.message(job, value);
    });
    worker.on('error', () => {
      this.fail(job);
    });
    worker.on('exit', () => {
      this.closed(job);
    });
    job.timer = setTimeout(() => {
      this.fail(job);
    }, SPEECH_TEMPO_TIMEOUT_MS);
    if (signal.aborted) {
      this.fail(job);
      return result.promise;
    }
    try {
      worker.postMessage(request, [pcm.buffer]);
    } catch {
      this.fail(job);
    }
    return result.promise;
  }

  /** Stops the worker and waits for physical retirement before returning. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const job = this.current;
    if (job === undefined) return;
    this.fail(job);
    await job.retired;
  }

  /** Accepts only a validated response for this worker and the sampled request. */
  private message(job: Job, value: unknown): void {
    if (this.current !== job || job.settled || job.retiring) return;
    const parsed = TEMPO_RESPONSE.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.epoch !== job.epoch ||
      parsed.data.unitId !== job.input.unitId ||
      parsed.data.part !== job.input.part ||
      parsed.data.rate !== job.input.rate ||
      parsed.data.type !== 'result'
    ) {
      this.fail(job);
      return;
    }
    // specs/SpeechTempo.tla, Result: only the current unit and part can own a result.
    job.result = new Int16Array(parsed.data.pcm);
    this.retire(job);
  }

  /** Rejects immediately but retains the physical slot while termination is pending. */
  private fail(job: Job): void {
    if (this.current !== job) return;
    if (!job.settled) {
      job.settled = true;
      job.reject(new Error('Speech transform failed.'));
    }
    this.retire(job);
  }

  /** Requests termination once; a rejection cannot be treated as physical exit. */
  private retire(job: Job): void {
    if (job.retiring) return;
    job.retiring = true;
    if (job.settled) clearTimeout(job.timer);
    try {
      void job.worker.terminate().then(
        () => {
          this.closed(job);
        },
        () => {},
      );
    } catch {
      // Keep the slot until an exit event confirms retirement.
    }
  }

  /** Releases the slot only when the worker has exited. */
  private closed(job: Job): void {
    if (this.current !== job) return;
    clearTimeout(job.timer);
    job.signal.removeEventListener('abort', job.abort);
    this.current = undefined;
    job.retireResolve();
    if (!job.settled) {
      job.settled = true;
      if (job.result === undefined) job.reject(new Error('Speech transform failed.'));
      else job.resolve(job.result);
    }
  }
}
