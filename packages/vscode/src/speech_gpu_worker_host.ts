import { LOCAL_REQUEST, type LocalResponse } from './speech_local_protocol';
import type { SpeechEngine, SpeechTokens } from './speech_synthesis';
import { SpeechWorkerHost } from './speech_worker_host';

/** A GPU engine and the operation that releases its native model resources. */
export interface DisposableGpuEngine<T extends SpeechTokens> {
  engine: SpeechEngine<T>;
  dispose(): Promise<void>;
}

/** Serializes worker work and disposes a model before the process closes. */
export class GpuWorkerHost<T extends SpeechTokens> {
  private readonly worker: SpeechWorkerHost<T>;
  private disposeModel?: () => Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(
    load: (modelPath: string) => Promise<DisposableGpuEngine<T>>,
    post: (value: LocalResponse) => void,
    private readonly close: () => void,
  ) {
    this.worker = new SpeechWorkerHost(async (modelPath) => {
      const loaded = await load(modelPath);
      this.disposeModel = () => loaded.dispose();
      return loaded.engine;
    }, post);
  }

  /** Queues one protocol message; a shutdown excludes all later messages. */
  receive(value: unknown): Promise<void> {
    if (this.closing) return this.tail;
    const parsed = LOCAL_REQUEST.safeParse(value);
    const shutdown = parsed.success && parsed.data.type === 'shutdown';
    if (shutdown) this.closing = true;
    const task = this.tail.then(async () => {
      try {
        await this.worker.receive(value);
      } finally {
        if (shutdown) {
          try {
            await this.disposeModel?.();
          } catch {
            /* Process closure still releases the model. */
          }
          this.close();
        }
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
}
