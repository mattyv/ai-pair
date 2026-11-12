/* oxlint-disable eslint/no-use-before-define -- timer callbacks are registered after their closures are initialized. */
import { SpeechDecodeLifecycle, type DecodeDocument, type DecodeProbe, type DecodeRequest } from './speech_decode_lifecycle';
import type { OpenRouterAudioDecoder, OpenRouterAudioDecodeLease, OpenRouterAudioInput, SpeechAudioResult } from './speech_types';

const MAX_MP3_BYTES = 1_920_000;
const MAX_PCM_BYTES = 15_360_000;
const SAMPLE_RATE = 24_000;
const MAX_OUTPUT_BYTES = 1_948_844;
const MAX_DURATION_MS = 40_600;
const HEADER_BYTES = 44;
const MAX_BASE64_LENGTH = 2_598_460;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96_000;
const MAX_AUDIO_SECONDS = 40;
const MS_PER_SECOND = 1000;
/** Fixed fields in a PCM WAV header. */
// oxlint-disable-next-line eslint/no-magic-numbers
const WAV = {
  riffSize: 4,
  riffPrefix: 8,
  wave: 8,
  formatEnd: 16,
  formatSize: 16,
  pcmCode: 20,
  channels: 22,
  sampleRate: 24,
  byteRate: 28,
  blockAlign: 32,
  bits: 34,
  data: 36,
  dataSize: 40,
  formatBytes: 16,
  sampleBits: 16,
} as const;

/** Rejects cloud synthesis when the local panel cannot reserve its decoder. */
export function createOpenRouterAudioDecoder(
  panel: () => { admitSpeechDecode?: OpenRouterAudioDecoder['admit'] } | undefined,
): OpenRouterAudioDecoder {
  return {
    admit: (speechId, signal) => {
      const owner = panel();
      return owner?.admitSpeechDecode?.(speechId, signal) ?? Promise.reject(new Error('Decoder unavailable'));
    },
  };
}

/** The local page messages required for decoder readiness and one decode. */
export type DecodeMessage =
  | { type: 'speechDecodeProbe'; document: DecodeDocument; probeId: number }
  | {
      type: 'speechDecode';
      document: DecodeDocument;
      requestId: number;
      speechId: number;
      format: 'mp3' | 'pcm';
      audioBase64: string;
      sampleRate?: number;
      channels?: number;
    };

/** The effects required to reach the locally owned webview. */
export interface SpeechDecodeBridgeOptions {
  post: (message: DecodeMessage) => Promise<boolean>;
  page: () => number | undefined;
  probeTimeoutMs: number;
  decodeTimeoutMs: number;
}

interface ProbeWait {
  probe: DecodeProbe;
  finish: (ready: boolean) => void;
}
interface DecodeWait {
  request: DecodeRequest;
  finish: (result?: SpeechAudioResult) => void;
  canceled: boolean;
}

/** Checks the normalized PCM WAV returned by the local page. */
function readOutput(value: { wavBase64: string; durationMs: number } | undefined): SpeechAudioResult | undefined {
  if (
    value === undefined ||
    typeof value.wavBase64 !== 'string' ||
    value.wavBase64.length > MAX_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.wavBase64) ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs <= 0 ||
    value.durationMs > MAX_DURATION_MS
  ) {
    return undefined;
  }
  const bytes = Buffer.from(value.wavBase64, 'base64');
  if (bytes.toString('base64') !== value.wavBase64 || bytes.length <= HEADER_BYTES || bytes.length > MAX_OUTPUT_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.toString('ascii', 0, WAV.riffSize) !== 'RIFF' ||
    view.getUint32(WAV.riffSize, true) !== bytes.length - WAV.riffPrefix ||
    bytes.toString('ascii', WAV.wave, WAV.formatEnd) !== 'WAVEfmt ' ||
    view.getUint32(WAV.formatSize, true) !== WAV.formatBytes ||
    view.getUint16(WAV.pcmCode, true) !== 1 ||
    view.getUint16(WAV.channels, true) !== 1 ||
    view.getUint32(WAV.sampleRate, true) !== SAMPLE_RATE ||
    view.getUint32(WAV.byteRate, true) !== SAMPLE_RATE * 2 ||
    view.getUint16(WAV.blockAlign, true) !== 2 ||
    view.getUint16(WAV.bits, true) !== WAV.sampleBits ||
    bytes.toString('ascii', WAV.data, WAV.dataSize) !== 'data' ||
    view.getUint32(WAV.dataSize, true) !== bytes.length - HEADER_BYTES ||
    (bytes.length - HEADER_BYTES) % 2 !== 0
  ) {
    return undefined;
  }
  return { wav: Uint8Array.from(bytes), durationMs: ((bytes.length - HEADER_BYTES) / 2 / SAMPLE_RATE) * MS_PER_SECOND };
}

/** Owns a single local decoder admission and the lifetime of its browser work. */
export class SpeechDecodeBridge implements OpenRouterAudioDecoder {
  private readonly lifecycle = new SpeechDecodeLifecycle();
  private document?: DecodeDocument;
  private generation = 0;
  private probeId = 0;
  private requestId = 0;
  private probeWait?: ProbeWait;
  private decodeWait?: DecodeWait;
  private activeCancel?: () => void;
  private bootPending = false;

  constructor(private readonly options: SpeechDecodeBridgeOptions) {}

  /** Allocates a document identity without replacing the active document. */
  prepare(pageId: number): DecodeDocument {
    this.bootPending = true;
    this.probeWait?.finish(false);
    this.activeCancel?.();
    return { pageId, documentGeneration: ++this.generation };
  }

  /** Activates a document after the browser confirms its boot token. */
  activate(document: DecodeDocument): void {
    this.probeWait?.finish(false);
    this.activeCancel?.();
    this.document = document;
    this.bootPending = false;
    this.lifecycle.activate(document);
  }

  /** Reopens admissions after the existing document confirms a recovery handshake. */
  resume(document: DecodeDocument): void {
    if (this.document !== undefined && this.matchesDocument(this.document, document)) this.bootPending = false;
  }

  /** Retires a document only when its browser instance is destroyed. */
  destroy(document: DecodeDocument): void {
    if (this.probeWait !== undefined && this.matchesDocument(this.probeWait.probe, document)) this.probeWait.finish(false);
    if (this.document !== undefined && this.matchesDocument(this.document, document)) {
      this.activeCancel?.();
      this.document = undefined;
    }
    if (this.decodeWait !== undefined && this.matchesDocument(this.decodeWait.request, document)) {
      this.decodeWait.finish();
      this.decodeWait = undefined;
    }
    this.lifecycle.destroy(document);
  }

  /** Accepts the readiness answer only for its pending document and probe. */
  ready(document: DecodeDocument, probeId: number, available: boolean): void {
    const wait = this.probeWait;
    if (wait === undefined || !this.matchesDocument(wait.probe, document) || wait.probe.probeId !== probeId) return;
    if (available && this.lifecycle.ready(wait.probe)) wait.finish(true);
    else wait.finish(false);
  }

  /** Retires only the matching physical decode and returns its validated result. */
  decoded(document: DecodeDocument, requestId: number, value?: { wavBase64: string; durationMs: number }): void {
    const wait = this.decodeWait;
    if (wait === undefined || !this.matchesDocument(wait.request, document) || wait.request.requestId !== requestId) return;
    this.decodeWait = undefined;
    const accepted = this.lifecycle.settle(wait.request);
    wait.finish(accepted && !wait.canceled ? readOutput(value) : undefined);
  }

  /** Reserves decoder capacity before a paid provider request. */
  async admit(speechId: number, signal: AbortSignal): Promise<OpenRouterAudioDecodeLease> {
    const document = this.document;
    if (
      document === undefined ||
      this.bootPending ||
      this.options.page() !== document.pageId ||
      signal.aborted ||
      this.probeWait !== undefined ||
      this.decodeWait !== undefined ||
      this.activeCancel !== undefined
    ) {
      throw new Error('Decoder unavailable');
    }
    if (!this.lifecycle.isReadyFor(document)) await this.probe(document, signal);
    if (signal.aborted || this.bootPending || this.document !== document || this.options.page() !== document.pageId) {
      throw new Error('Decoder unavailable');
    }
    const request = { ...document, requestId: ++this.requestId };
    if (!this.lifecycle.begin(request)) throw new Error('Decoder unavailable');
    let used = false;
    const admission = new AbortController();
    const cancel = (): void => {
      admission.abort();
      this.lifecycle.cancel(request);
      if (this.activeCancel === cancel) this.activeCancel = undefined;
      if (this.decodeWait?.request === request) {
        this.decodeWait.canceled = true;
        this.decodeWait.finish();
      }
    };
    this.activeCancel = cancel;
    return {
      signal: admission.signal,
      cancel,
      decode: (input, decodeSignal) => {
        if (used || this.activeCancel !== cancel) return Promise.reject(new Error('Decoder unavailable'));
        used = true;
        return this.decode(request, speechId, input, decodeSignal);
      },
    };
  }

  private matchesDocument(left: DecodeDocument, right: DecodeDocument): boolean {
    return left.pageId === right.pageId && left.documentGeneration === right.documentGeneration;
  }

  private probe(document: DecodeDocument, signal: AbortSignal): Promise<void> {
    const probe = { ...document, probeId: ++this.probeId };
    if (!this.lifecycle.probe(probe)) return Promise.reject(new Error('Decoder unavailable'));
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (available: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.probeWait = undefined;
        if (available) resolve();
        else {
          this.lifecycle.probeFailed(probe);
          reject(new Error('Decoder unavailable'));
        }
      };
      function abort(): void {
        finish(false);
      }
      const timer = setTimeout(abort, this.options.probeTimeoutMs);
      this.probeWait = { probe, finish };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        finish(false);
        return;
      }
      try {
        void this.options.post({ type: 'speechDecodeProbe', document, probeId: probe.probeId }).then(
          (sent) => {
            if (!sent) finish(false);
          },
          () => {
            finish(false);
          },
        );
      } catch {
        finish(false);
      }
    });
  }

  private decode(request: DecodeRequest, speechId: number, input: OpenRouterAudioInput, signal: AbortSignal): Promise<SpeechAudioResult> {
    if (
      signal.aborted ||
      input.bytes.length === 0 ||
      input.bytes.length > (input.format === 'mp3' ? MAX_MP3_BYTES : MAX_PCM_BYTES) ||
      (input.format === 'pcm' &&
        (!Number.isInteger(input.sampleRate) ||
          input.sampleRate < MIN_SAMPLE_RATE ||
          input.sampleRate > MAX_SAMPLE_RATE ||
          (input.channels !== 1 && input.channels !== 2) ||
          input.bytes.length % (input.channels * 2) !== 0 ||
          input.bytes.length > input.sampleRate * input.channels * 2 * MAX_AUDIO_SECONDS)) ||
      !this.lifecycle.dispatch(request)
    ) {
      return Promise.reject(new Error('Decoder unavailable'));
    }
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (result?: SpeechAudioResult): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (this.activeCancel === cancel) this.activeCancel = undefined;
        if (result !== undefined) resolve(result);
        else reject(new Error('Decoder unavailable'));
      };
      const cancel = this.activeCancel;
      function abort(): void {
        cancel?.();
      }
      const timer = setTimeout(abort, this.options.decodeTimeoutMs);
      this.decodeWait = { request, finish, canceled: false };
      signal.addEventListener('abort', abort, { once: true });
      const message: DecodeMessage = {
        type: 'speechDecode',
        document: { pageId: request.pageId, documentGeneration: request.documentGeneration },
        requestId: request.requestId,
        speechId,
        format: input.format,
        audioBase64: Buffer.from(input.bytes).toString('base64'),
        ...(input.format === 'pcm' ? { sampleRate: input.sampleRate, channels: input.channels } : {}),
      };
      try {
        void this.options.post(message).then(
          (sent) => {
            if (!sent) this.postFailed(request);
          },
          () => {
            this.postFailed(request);
          },
        );
      } catch {
        this.postFailed(request);
      }
    });
  }

  private postFailed(request: DecodeRequest): void {
    if (this.decodeWait?.request !== request) return;
    const wait = this.decodeWait;
    this.decodeWait = undefined;
    this.lifecycle.settle(request);
    wait.finish();
  }
}
