import { SPEECH_WORKER_INPUT, type SpeechWorkerOutput } from './speech_worker_messages';
import { synthesizeSpeech, type SpeechEngine, type SpeechTokens } from './speech_synthesis';

/** Handles one model and at most one job in a dedicated worker thread. */
export class SpeechWorkerHost<T extends SpeechTokens> {
  private engine?: SpeechEngine<T>;
  private busy = false;

  constructor(
    private readonly load: (modelPath: string) => Promise<SpeechEngine<T>>,
    private readonly post: (message: SpeechWorkerOutput) => void,
  ) {}

  /** Validates and handles a worker request, sending a bounded response. */
  async receive(raw: unknown): Promise<void> {
    const parsed = SPEECH_WORKER_INPUT.safeParse(raw);
    if (!parsed.success) {
      this.post({ type: 'error', message: 'Invalid speech request.' });
      return;
    }
    const request = parsed.data;
    if (request.type === 'load') {
      if (this.busy || this.engine !== undefined) {
        this.post({ type: 'error', message: 'Speech is already loading or ready.' });
        return;
      }
      this.busy = true;
      try {
        this.engine = await this.load(request.modelPath);
        this.post({ type: 'ready' });
      } catch {
        this.post({ type: 'error', message: 'Could not load local speech. Retry setup.' });
      } finally {
        this.busy = false;
      }
      return;
    }
    const engine = this.engine;
    if (this.busy || engine === undefined) {
      this.post({
        type: 'error',
        id: request.id,
        ...(request.part === undefined ? {} : { part: request.part }),
        message: 'Local speech is busy or unavailable.',
      });
      return;
    }
    this.busy = true;
    try {
      const result = await synthesizeSpeech(engine, {
        text: request.text,
        voice: request.voice,
        speed: request.speed,
        ...(request.final === undefined ? {} : { final: request.final }),
      });
      this.post({
        type: 'audio',
        id: request.id,
        ...(request.part === undefined ? {} : { part: request.part }),
        wav: new Uint8Array(result.wav),
        durationMs: result.durationMs,
      });
    } catch {
      this.post({
        type: 'error',
        id: request.id,
        ...(request.part === undefined ? {} : { part: request.part }),
        message: 'Could not speak this text. Continue reading it.',
      });
    } finally {
      this.busy = false;
    }
  }
}
