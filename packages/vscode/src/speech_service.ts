import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NarrationPort } from '@ai-pair/core';
import { installedSpeechModel } from './speech_setup';
import { speechRuntimeAvailable } from './speech_runtime_status';
import {
  ELEVENLABS_SPEEDS,
  SPEECH_PREVIEW_TEXT,
  SPEECH_SPEEDS,
  SPEECH_VOICES,
  type ElevenLabsSpeechPort,
  type LocalSpeechFailureReason,
  type SpeechProvider,
  type SpeechSettings,
  type SpeechVoice,
} from './speech_types';
import { SPEECH_WORKER_OUTPUT } from './speech_worker_messages';

/** The panel operations used by local speech; audio is never added to history. */
export interface SpeechOutput {
  /** Checks and reserves the selected route before synthesis. */
  prepare?: (id: number) => Promise<boolean>;
  /** Fixed, non-sensitive local worker lifecycle facts. */
  localDiagnostic?: (phase: 'ready' | 'failed', reason?: LocalSpeechFailureReason) => void;
  /** Posts audio and returns its current page ID, or undefined when no page is ready. */
  play: (id: number, wav: Uint8Array, durationMs: number) => number | undefined;
  /** Controls only the audio belonging to the given page and generation. */
  control: (id: number, pageId: number, action: 'pause' | 'resume' | 'stop') => void;
  /** Displays a short live state or a text-only fallback reason. */
  status: (id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string) => void;
}

/** Inputs needed by the speech service. */
export interface SpeechServiceOptions {
  runtimeDirectory: string;
  storageDirectory: string;
  localDesktop: boolean;
  kokoroSupported?: boolean;
  cloud?: ElevenLabsSpeechPort;
  output: SpeechOutput;
  settings(): SpeechSettings;
}

/** An acknowledgement from the page that received a particular generation. */
export interface SpeechAudioEvent {
  id: number;
  pageId: number;
  event: 'started' | 'ended' | 'failed';
}

interface ActiveSpeech {
  id: number;
  text: string;
  provider: SpeechProvider;
  cloudVoice: string;
  voice: SpeechVoice;
  speed: number;
  resolve(): void;
  phase: 'admitting' | 'loading' | 'synthesizing' | 'prepared' | 'playing';
  wav: Uint8Array;
  durationMs: number;
  pageId?: number;
  started: boolean;
  preview: boolean;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: number;
  remaining: number;
}

/** Maximum time for a worker or page to acknowledge its work. */
const START_TIMEOUT_MS = 20_000;
/** Maximum time to discover a selected output before provider requests. */
const OUTPUT_TIMEOUT_MS = 5000;
/** Extra unpaused time allowed after the waveform's duration. */
const PLAYBACK_GRACE_MS = 5000;
/** The fixed PCM WAV header length. */
const MIN_WAV_BYTES = 44;
/** Largest supported PCM WAV, including the thinking interval and header. */
const MAX_WAV_BYTES = 1_948_844;
/** Longest waveform including its 600 ms thinking interval. */
const MAX_DURATION_MS = 40_600;

/** Classifies only Node's fixed error codes; never carries the error itself. */
function localWorkerError(error: unknown): LocalSpeechFailureReason {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'worker_error';
  if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') return 'worker_module';
  if (error.code === 'ERR_DLOPEN_FAILED') return 'worker_native';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'worker_permission';
  return 'worker_error';
}

/** Coordinates one local synthesis job and one page-owned audio buffer. */
export class SpeechService implements NarrationPort {
  private nextId = 1;
  private current?: ActiveSpeech;
  private paused = false;
  private worker?: Worker;
  private workerReady = false;
  private workerBusyId?: number;
  private workerTimer?: ReturnType<typeof setTimeout>;
  private cloudBusy?: { id: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
  private closing = false;
  private disposed = false;

  constructor(private readonly options: SpeechServiceOptions) {}

  /** Speaks an explicitly selected live unit when enabled. */
  speak(text: string): Promise<void> {
    if (!this.options.settings().enabled) return Promise.resolve();
    if (this.current?.preview === true) this.cancel();
    return this.begin(text, false);
  }

  /** Plays the fixed, visible voice sample without requiring a pairing session. */
  preview(): Promise<void> {
    return this.begin(SPEECH_PREVIEW_TEXT, true);
  }

  private begin(text: string, preview: boolean): Promise<void> {
    if (this.current !== undefined || this.disposed) return Promise.resolve();
    const id = this.nextId++;
    const settings = this.options.settings();
    if (!this.options.localDesktop) {
      this.options.output.status(
        id,
        'unavailable',
        settings.provider === 'elevenlabs'
          ? 'Cloud speech is available only on a local desktop.'
          : 'Local speech is available on a local Linux x64 desktop using glibc.',
      );
      return Promise.resolve();
    }
    const provider = settings.provider ?? 'kokoro';
    if (provider !== 'kokoro' && provider !== 'elevenlabs') {
      this.options.output.status(id, 'unavailable', 'Choose a supported speech provider.');
      return Promise.resolve();
    }
    const voice = SPEECH_VOICES.find((candidate) => candidate === settings.voice);
    if (provider === 'kokoro' && (this.options.kokoroSupported === false || process.platform !== 'linux' || process.arch !== 'x64')) {
      this.options.output.status(id, 'unavailable', 'Local speech is available on a local Linux x64 desktop using glibc.');
      return Promise.resolve();
    }
    if (provider === 'kokoro' && (voice === undefined || !SPEECH_SPEEDS.some((speed) => speed === settings.speed))) {
      this.options.output.status(id, 'unavailable', 'Choose a supported speech voice and speed.');
      return Promise.resolve();
    }
    if (
      provider === 'elevenlabs' &&
      (this.options.cloud === undefined ||
        settings.elevenLabsVoice.length === 0 ||
        !ELEVENLABS_SPEEDS.some((speed) => speed === settings.elevenLabsSpeed))
    ) {
      this.options.output.status(id, 'unavailable', 'Choose an available ElevenLabs voice and speed.');
      return Promise.resolve();
    }
    if (this.workerBusyId !== undefined || this.closing || this.cloudBusy !== undefined) {
      this.options.output.status(id, 'unavailable', 'Speech is still finishing; try again shortly.');
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    const current: ActiveSpeech = {
      id,
      text,
      provider,
      cloudVoice: settings.elevenLabsVoice,
      voice: voice ?? 'af_heart',
      speed: provider === 'elevenlabs' ? settings.elevenLabsSpeed : settings.speed,
      resolve,
      phase: 'admitting',
      wav: new Uint8Array(),
      durationMs: 0,
      started: false,
      preview,
      remaining: START_TIMEOUT_MS,
    };
    this.current = current;
    this.options.output.status(id, 'preparing');
    if (this.current === current) {
      if (this.options.output.prepare === undefined) this.beginProvider(current);
      else void this.admit(current);
    }
    return promise;
  }

  private beginProvider(current: ActiveSpeech): void {
    // specs/OutputHandoff.tla, Admit: worker readiness cannot bypass admission.
    current.phase = 'loading';
    if (current.provider === 'elevenlabs') this.startCloud(current);
    else {
      this.arm(current, START_TIMEOUT_MS);
      void this.start(current);
    }
  }

  private async admit(current: ActiveSpeech): Promise<void> {
    current.timer = setTimeout(() => {
      if (this.current === current) this.fail(current, 'Selected speech output is unavailable.');
    }, OUTPUT_TIMEOUT_MS);
    try {
      const ready = await this.options.output.prepare?.(current.id);
      if (this.current !== current) return;
      this.clearTimer(current);
      if (ready !== true) this.fail(current, 'Selected speech output is unavailable.');
      else this.beginProvider(current);
    } catch {
      if (this.current === current) this.fail(current, 'Selected speech output is unavailable.');
    }
  }

  /** CloudNarration: one request owns its slot until settlement or watchdog. */
  private startCloud(current: ActiveSpeech): void {
    const cloud = this.options.cloud;
    if (cloud === undefined) {
      this.fail(current, 'Cloud speech is unavailable. Check your key, voice and account.');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (this.cloudBusy?.id !== current.id) return;
      controller.abort();
      this.cloudBusy = undefined;
      if (this.current === current) this.fail(current, 'Cloud speech timed out; continue reading.');
    }, START_TIMEOUT_MS);
    this.cloudBusy = { id: current.id, controller, timer };
    current.phase = 'synthesizing';
    const release = (): void => {
      if (this.cloudBusy?.id !== current.id) return;
      clearTimeout(timer);
      this.cloudBusy = undefined;
    };
    try {
      void cloud.synthesize({ text: current.text, voiceId: current.cloudVoice, speed: current.speed }, controller.signal).then(
        (audio) => {
          release();
          if (this.current !== current || controller.signal.aborted) return;
          if (
            audio.wav.length < MIN_WAV_BYTES ||
            audio.wav.length > MAX_WAV_BYTES ||
            !Number.isFinite(audio.durationMs) ||
            audio.durationMs <= 0 ||
            audio.durationMs > MAX_DURATION_MS
          ) {
            this.fail(current, 'Generated speech was invalid; continue reading.');
            return;
          }
          current.wav = audio.wav;
          current.durationMs = audio.durationMs;
          current.phase = 'prepared';
          if (this.paused) this.options.output.status(current.id, 'paused');
          else this.play(current);
        },
        () => {
          release();
          if (this.current === current) this.fail(current, 'Cloud speech is unavailable. Check your key, voice and account.');
        },
      );
    } catch {
      release();
      this.fail(current, 'Cloud speech is unavailable. Check your key, voice and account.');
    }
  }

  /** A credential change invalidates current cloud audio and pending requests. */
  invalidateCloud(): void {
    this.cloudBusy?.controller.abort();
    if (this.current?.provider === 'elevenlabs') this.cancel();
  }

  private async start(current: ActiveSpeech): Promise<void> {
    if (this.workerReady && this.worker !== undefined) {
      this.synthesize(current, this.worker);
      return;
    }
    if (this.worker !== undefined) return;
    try {
      const available = await speechRuntimeAvailable(this.options.runtimeDirectory);
      if (this.current !== current) return;
      if (!available) {
        this.localDiagnostic('failed', 'runtime_missing');
        this.fail(current, 'This installation does not include the local speech runtime.');
        return;
      }
      const modelPath = await installedSpeechModel(this.options.storageDirectory);
      if (this.current !== current) return;
      if (modelPath === undefined) {
        this.localDiagnostic('failed', 'model_missing');
        this.fail(current, 'Download the Kokoro model in Settings to hear local narration.');
        return;
      }
      const worker = new Worker(path.join(this.options.runtimeDirectory, 'worker.mjs'), { workerData: { modelPath } });
      this.worker = worker;
      worker.on('message', (message: unknown) => {
        this.workerMessage(worker, message);
      });
      worker.on('error', (error: unknown) => {
        this.workerFailed(worker, localWorkerError(error));
      });
      worker.on('exit', () => {
        this.workerFailed(worker, 'worker_exit');
      });
      this.armWorker(worker);
      worker.postMessage({ type: 'load', modelPath });
    } catch (error: unknown) {
      if (this.current !== current) return;
      if (this.worker !== undefined) this.workerFailed(this.worker, localWorkerError(error));
      else {
        this.localDiagnostic('failed', localWorkerError(error));
        this.fail(current, 'Local speech could not start. Retry setup.');
      }
    }
  }

  private synthesize(current: ActiveSpeech, worker: Worker): void {
    current.phase = 'synthesizing';
    this.workerBusyId = current.id;
    this.clearTimer(current);
    this.armWorker(worker);
    try {
      worker.postMessage({ type: 'synthesize', id: current.id, text: current.text, voice: current.voice, speed: current.speed });
    } catch {
      this.workerFailed(worker);
    }
  }

  private workerMessage(worker: Worker, raw: unknown): void {
    if (worker !== this.worker) return;
    const parsed = SPEECH_WORKER_OUTPUT.safeParse(raw);
    if (!parsed.success) {
      this.workerFailed(worker);
      return;
    }
    const message = parsed.data;
    const current = this.current;
    if (message.type === 'ready') {
      if (this.workerReady) return;
      this.clearWorkerTimer();
      this.workerReady = true;
      this.localDiagnostic('ready');
      if (current !== undefined && current.phase === 'loading') this.synthesize(current, worker);
      return;
    }
    if (message.id !== undefined && message.id === this.workerBusyId) {
      this.workerBusyId = undefined;
      this.clearWorkerTimer();
    }
    if (message.type === 'error') {
      if (message.id === undefined) {
        this.workerFailed(worker, this.workerReady ? 'worker_error' : 'model_load');
      } else if (current?.id === message.id) {
        this.localDiagnostic('failed', 'synthesis');
        this.fail(current, message.message);
      }
      return;
    }
    if (current?.id !== message.id || current.phase !== 'synthesizing') return;
    if (message.wav.length < MIN_WAV_BYTES || message.wav.length > MAX_WAV_BYTES || message.durationMs > MAX_DURATION_MS) {
      this.fail(current, 'Generated speech was invalid; continue reading.');
      return;
    }
    current.wav = message.wav;
    current.durationMs = message.durationMs;
    current.phase = 'prepared';
    this.clearTimer(current);
    if (this.paused) {
      this.options.output.status(current.id, 'paused');
    } else {
      this.play(current);
    }
  }

  private play(current: ActiveSpeech): void {
    this.options.output.status(current.id, 'preparing');
    if (this.current !== current) return;
    let pageId: number | undefined;
    try {
      pageId = this.options.output.play(current.id, current.wav, current.durationMs);
    } catch {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Audio could not play. Open the Pair panel and try Preview voice.');
      return;
    }
    current.wav = new Uint8Array();
    if (this.current !== current) {
      if (pageId !== undefined) this.options.output.control(current.id, pageId, 'stop');
      return;
    }
    if (pageId === undefined) {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Open the Pair panel to hear speech.');
      return;
    }
    current.pageId = pageId;
    current.phase = 'playing';
    this.arm(current, START_TIMEOUT_MS);
  }

  /** Accepts page acknowledgements only for the current page and generation. */
  audioEvent(event: SpeechAudioEvent): 'ended' | 'failed' | undefined {
    const current = this.current;
    if (current === undefined || current.id !== event.id || current.pageId !== event.pageId || current.phase !== 'playing') {
      return undefined;
    }
    if (event.event === 'failed') {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Audio could not play. Use Preview voice to enable audio.');
      return 'failed';
    } else if (event.event === 'ended') {
      this.finish(current);
      return 'ended';
    } else {
      if (current.started) return undefined;
      current.started = true;
      current.remaining = current.durationMs + PLAYBACK_GRACE_MS;
      if (!this.paused) this.arm(current, current.remaining);
      this.options.output.status(current.id, this.paused ? 'paused' : 'speaking');
      return undefined;
    }
  }

  /** Pauses current playback and its watchdog without advancing reading. */
  pause(): void {
    this.paused = true;
    const current = this.current;
    if (current === undefined) return;
    if (current.phase === 'playing' && current.pageId !== undefined) {
      this.freeze(current);
      this.options.output.control(current.id, current.pageId, 'pause');
    }
    this.options.output.status(current.id, 'paused');
  }

  /** Resumes only the current generation after all pause reasons clear. */
  resume(): void {
    this.paused = false;
    const current = this.current;
    if (current === undefined) return;
    if (current.phase === 'prepared') {
      this.play(current);
    } else if (current.phase === 'playing' && current.pageId !== undefined) {
      this.options.output.control(current.id, current.pageId, 'resume');
      this.arm(current, current.remaining);
      this.options.output.status(current.id, current.started ? 'speaking' : 'preparing');
    } else {
      this.options.output.status(current.id, 'preparing');
    }
  }

  /** Stops audio and invalidates pending synthesis without waiting for CPU inference. */
  cancel(): void {
    const current = this.current;
    if (current !== undefined) this.finish(current);
  }

  /** Cancels audio if its owning page disappears. */
  pageClosed(pageId: number): void {
    const current = this.current;
    if (current !== undefined && (current.pageId === pageId || current.pageId === undefined)) this.cancel();
  }

  /** Releases the worker and all pending speech. */
  dispose(): void {
    this.disposed = true;
    this.cancel();
    if (this.worker !== undefined) this.workerFailed(this.worker);
  }

  /** Bounds model loading and inference independently of the visible speech gate. */
  private armWorker(worker: Worker): void {
    this.clearWorkerTimer();
    const timer = setTimeout(() => {
      if (this.workerTimer === timer) this.workerFailed(worker, 'timeout');
    }, START_TIMEOUT_MS);
    this.workerTimer = timer;
  }

  private clearWorkerTimer(): void {
    if (this.workerTimer !== undefined) clearTimeout(this.workerTimer);
    this.workerTimer = undefined;
  }

  private arm(current: ActiveSpeech, ms: number): void {
    this.clearTimer(current);
    current.remaining = ms;
    current.deadline = Date.now() + ms;
    current.timer = setTimeout(() => {
      if ((current.phase === 'loading' || current.phase === 'synthesizing') && this.worker !== undefined) {
        this.workerFailed(this.worker, 'timeout');
      } else {
        if (current.provider === 'kokoro') this.localDiagnostic('failed', 'timeout');
        this.fail(current, 'Speech timed out; continue reading.');
      }
    }, ms);
  }

  private freeze(current: ActiveSpeech): void {
    if (current.deadline !== undefined) current.remaining = Math.max(0, current.deadline - Date.now());
    this.clearTimer(current);
  }

  private clearTimer(current: ActiveSpeech): void {
    if (current.timer !== undefined) clearTimeout(current.timer);
    current.timer = undefined;
    current.deadline = undefined;
  }

  private fail(current: ActiveSpeech, message: string): void {
    if (this.current !== current) return;
    this.options.output.status(current.id, 'unavailable', message);
    this.finish(current, /* showIdle= */ false);
  }

  private finish(current: ActiveSpeech, showIdle = true): void {
    if (this.current !== current) return;
    this.current = undefined;
    if (current.provider === 'elevenlabs' && this.cloudBusy?.id === current.id) this.cloudBusy.controller.abort();
    this.clearTimer(current);
    if (current.pageId !== undefined) this.options.output.control(current.id, current.pageId, 'stop');
    if (showIdle) this.options.output.status(current.id, 'idle');
    current.resolve();
  }

  /** Diagnostics must never change speech behavior or reveal exception text. */
  private localDiagnostic(phase: 'ready' | 'failed', reason?: LocalSpeechFailureReason): void {
    try {
      this.options.output.localDiagnostic?.(phase, reason);
    } catch {
      /* Observability is best effort. */
    }
  }

  private workerFailed(worker: Worker, reason: LocalSpeechFailureReason = 'worker_error'): void {
    if (worker !== this.worker) return;
    this.clearWorkerTimer();
    this.worker = undefined;
    this.workerReady = false;
    this.workerBusyId = undefined;
    this.closing = true;
    void worker
      .terminate()
      .catch(() => {})
      .finally(() => {
        this.closing = false;
      });
    if (this.current?.provider === 'kokoro') {
      this.localDiagnostic('failed', reason);
      this.fail(this.current, 'Local speech stopped. Retry setup.');
    }
  }
}
