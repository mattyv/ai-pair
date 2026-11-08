import { LOCAL_CAPABILITIES, LOCAL_PROTOCOL_VERSION, LOCAL_REQUEST, type LocalResponse, type LocalRequest } from './speech_local_protocol';
import { synthesizeSpeech, type SpeechEngine, type SpeechTokens } from './speech_synthesis';

/** The ownership a failure names, when the request it answers had one. */
interface FailureOwner {
  id?: number;
  part?: number;
}

/** Handles one model and at most one job in a dedicated worker thread. */
export class SpeechWorkerHost<T extends SpeechTokens> {
  private engine?: SpeechEngine<T>;
  private epoch?: number;
  private busy = false;
  private closed = false;

  constructor(
    private readonly load: (modelPath: string) => Promise<SpeechEngine<T>>,
    private readonly post: (message: LocalResponse) => void,
  ) {}

  /** Validates and handles a worker request, sending a bounded response. */
  async receive(raw: unknown): Promise<void> {
    const parsed = LOCAL_REQUEST.safeParse(raw);
    if (!parsed.success) {
      this.fail('protocol', {});
      return;
    }
    const request = parsed.data;
    if (request.type === 'init') {
      await this.init(request);
    } else if (request.type === 'shutdown') {
      this.closed = true;
      this.engine = undefined;
    } else {
      await this.synthesize(request);
    }
  }

  /** Loads the host-supplied model for exactly one epoch. */
  private async init(request: Extract<LocalRequest, { type: 'init' }>): Promise<void> {
    if (this.epoch !== undefined) {
      this.fail('protocol', {});
      return;
    }
    this.epoch = request.epoch;
    try {
      this.engine = await this.load(request.modelPath);
    } catch {
      this.fail('load', {});
      return;
    }
    this.post({
      type: 'ready',
      version: LOCAL_PROTOCOL_VERSION,
      epoch: request.epoch,
      capabilities: { ...LOCAL_CAPABILITIES, voices: [...LOCAL_CAPABILITIES.voices], speeds: [...LOCAL_CAPABILITIES.speeds] },
    });
  }

  /** Runs one inference for the loaded epoch, echoing the unit and part that own it. */
  private async synthesize(request: Extract<LocalRequest, { type: 'synthesize' }>): Promise<void> {
    const owner = { id: request.id, part: request.part };
    const engine = this.engine;
    if (this.closed || engine === undefined || request.epoch !== this.epoch) {
      this.fail('protocol', owner);
      return;
    }
    if (this.busy) {
      this.fail('busy', owner);
      return;
    }
    this.busy = true;
    try {
      const result = await synthesizeSpeech(engine, {
        text: request.text,
        voice: request.voice,
        speed: request.speed,
        final: request.final,
      });
      this.post({
        type: 'result',
        version: LOCAL_PROTOCOL_VERSION,
        epoch: request.epoch,
        ...owner,
        wav: new Uint8Array(result.wav),
        durationMs: result.durationMs,
      });
    } catch {
      this.fail('synthesis', owner);
    } finally {
      this.busy = false;
    }
  }

  /** Sends a fixed-category failure, without any text from the request or the error. */
  private fail(category: Extract<LocalResponse, { type: 'failure' }>['category'], owner: FailureOwner): void {
    this.post({
      type: 'failure',
      version: LOCAL_PROTOCOL_VERSION,
      ...(this.epoch === undefined ? {} : { epoch: this.epoch }),
      ...owner,
      category,
    });
  }
}
