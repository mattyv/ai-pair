import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NarrationPort } from '@ai-pair/core';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisOutcome, type LocalSynthesisPort } from './speech_local_client';
import {
  LOCAL_MAX_DURATION_MS,
  LOCAL_MAX_WAV_BYTES,
  LOCAL_MIN_WAV_BYTES,
  LOCAL_WORKER_TIMEOUT_MS,
  localWorkerError,
} from './speech_local_protocol';
import { installedSpeechModel } from './speech_setup';
import { speechRuntimeAvailable } from './speech_runtime_status';
import {
  ELEVENLABS_SPEEDS,
  SPEECH_PREVIEW_TEXT,
  SPEECH_SPEEDS,
  SPEECH_VOICES,
  speechListeningRate,
  type ElevenLabsSpeechPort,
  type LocalSpeechFailureReason,
  type SpeechProvider,
  type SpeechSettings,
  type SpeechVoice,
} from './speech_types';
import { speechSegments } from './speech_segments';
import { decodeSpeechWav, encodeTempoWav } from './speech_tempo_pcm';
import type { SpeechTempoRate } from './speech_tempo';
import type { GpuCheck, SpeechComputeBackend, SpeechComputeMode } from './speech_compute_types';
import type { GpuCapabilityResult } from './speech_gpu_capability';
import { GpuProcessBusyError, type GpuLaunchCapability } from './speech_gpu_client';

/** The panel operations used by local speech; audio is never added to history. */
export interface SpeechOutput {
  /** Supports sequential parts under one local route reservation. */
  parts?: boolean;
  /** Checks and reserves the selected route before synthesis. */
  prepare?: (id: number) => Promise<boolean>;
  /** Cancels a reserved or pending route before a page has begun playback. */
  cancel?: (id: number) => void;
  /** Fixed, non-sensitive local worker lifecycle facts. */
  localDiagnostic?: (phase: 'ready' | 'failed', reason?: LocalSpeechFailureReason) => void;
  /** Posts audio and returns its current page ID, or undefined when no page is ready. */
  play: (id: number, wav: Uint8Array, durationMs: number, part?: number) => number | undefined;
  /** Controls only the audio belonging to the given page and generation. */
  control: (id: number, pageId: number, action: 'pause' | 'resume' | 'stop') => void;
  /** Displays a short live state or a text-only fallback reason. */
  status: (id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string) => void;
}

/** A local, single-slot tempo worker with cancelable unit ownership. */
export interface SpeechTempoProcessor {
  transform(request: { unitId: number; part: number; rate: SpeechTempoRate; pcm: Int16Array }, signal: AbortSignal): Promise<Int16Array>;
  /** True while a transform, even a retiring one, still owns the worker slot. */
  busy(): boolean;
  dispose(): Promise<void>;
}

/** Fixed, non-sensitive cloud request failure categories. */
export type CloudSpeechFailureReason = 'no_key' | 'auth' | 'rate' | 'network' | 'timeout' | 'invalid' | 'canceled' | 'unknown';

/** Maps only recognized provider categories; never forwards exception text. */
function cloudFailureReason(error: unknown): CloudSpeechFailureReason {
  const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined;
  if (kind === 'key') return 'no_key';
  if (kind === 'auth' || kind === 'rate' || kind === 'network' || kind === 'timeout' || kind === 'invalid' || kind === 'canceled') {
    return kind;
  }
  return 'unknown';
}

/** Gives the programmer a fixed explanation without exposing provider data. */
function cloudFailureMessage(reason: Exclude<CloudSpeechFailureReason, 'canceled'>): string {
  switch (reason) {
    case 'no_key':
      return 'Cloud speech needs an ElevenLabs API key.';
    case 'auth':
      return 'ElevenLabs could not authorize this request. Check your key, voice and account access.';
    case 'rate':
      return 'ElevenLabs rate limit reached. Continue reading and try again later.';
    case 'network':
      return 'Cloud speech could not reach ElevenLabs or the service returned an error.';
    case 'timeout':
      return 'Cloud speech timed out; continue reading.';
    case 'invalid':
      return 'Cloud speech received an invalid response or request.';
    default:
      return 'Cloud speech is unavailable. Continue reading.';
  }
}

/** Inputs needed by the speech service. */
export interface SpeechServiceOptions {
  runtimeDirectory: string;
  storageDirectory: string;
  localDesktop: boolean;
  kokoroSupported?: boolean;
  cloud?: ElevenLabsSpeechPort;
  /** Records a sanitized failure for preview and ordinary narration. */
  cloudDiagnostic?: (reason: CloudSpeechFailureReason) => void;
  tempo?: SpeechTempoProcessor;
  /** Makes the local synthesis engine; absent means the packaged Node worker. */
  createLocal?: (listener: LocalListener) => LocalSynthesisPort;
  output: SpeechOutput;
  settings(): SpeechSettings;
  /** Samples the requested local compute mode when speech is admitted. */
  computeMode?: () => SpeechComputeMode;
  /** Reports the local worker's observed backend. */
  actualBackend?: (value: SpeechComputeBackend) => void;
  /** Requests fresh GPU proof before starting a GPU worker. */
  gpuCapability?: () => Promise<GpuCapabilityResult>;
  /** Creates an isolated GPU worker using the fresh capability. */
  createGpu?: (capability: GpuLaunchCapability, listener: LocalListener) => LocalSynthesisPort;
  /** Reports fixed GPU availability when Auto falls back. */
  gpuCheck?: (value: Extract<GpuCheck, { phase: 'unavailable' }>) => void;
  /** Reports a setup proof or download that owns the shared GPU slot. */
  gpuExternalBusy?: () => boolean;
}

/** An acknowledgement from the page that received a particular generation. */
export interface SpeechAudioEvent {
  id: number;
  pageId: number;
  event: 'started' | 'ended' | 'failed';
  part?: number;
}

interface ActiveSpeech {
  id: number;
  text: string;
  parts: string[];
  multipart: boolean;
  nextPart: number;
  part: number;
  lookaheadAllowed: boolean;
  buffered?: { part: number; wav: Uint8Array; durationMs: number };
  aggregateMs: number;
  listeningRate: SpeechTempoRate;
  processing?: { part: number; controller: AbortController };
  provider: SpeechProvider;
  computeMode: SpeechComputeMode;
  cloudVoice: string;
  voice: SpeechVoice;
  speed: number;
  resolve(): void;
  phase: 'admitting' | 'loading' | 'synthesizing' | 'transforming' | 'prepared' | 'playing';
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
const START_TIMEOUT_MS = LOCAL_WORKER_TIMEOUT_MS;
// Three 120-second proof stages plus the physical probe and scheduling allowance.
const GPU_PROOF_TIMEOUT_MS = 400_000;
/** Maximum time to discover a selected output before provider requests. */
const OUTPUT_TIMEOUT_MS = 5000;
/** Extra unpaused time allowed after the waveform's duration. */
const PLAYBACK_GRACE_MS = 5000;
const MIN_WAV_BYTES = LOCAL_MIN_WAV_BYTES;
const MAX_WAV_BYTES = LOCAL_MAX_WAV_BYTES;
const MAX_DURATION_MS = LOCAL_MAX_DURATION_MS;

/** Coordinates one local synthesis job and one page-owned audio buffer. */
export class SpeechService implements NarrationPort {
  private nextId = 1;
  private current?: ActiveSpeech;
  private paused = false;
  private local: LocalSynthesisPort;
  private readonly cpuLocal: LocalSynthesisPort;
  private localBackend: 'cpu' | 'gpu' = 'cpu';
  private gpuProofBusy = false;
  private cloudBusy?: { id: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
  private disposed = false;

  constructor(private readonly options: SpeechServiceOptions) {
    const listener: LocalListener = {
      ready: () => {
        this.localReady();
      },
      retired: (reason) => {
        this.localRetired(reason);
      },
    };
    this.cpuLocal =
      options.createLocal?.(listener) ??
      new LocalSynthesisClient({
        // The pinned phonemizer bridge reads the verified model directory from workerData.
        spawn: (modelPath) => new Worker(path.join(options.runtimeDirectory, 'worker.mjs'), { workerData: { modelPath } }),
        listener,
      });
    this.local = this.cpuLocal;
  }

  /** Reports whether a GPU proof or worker still owns its slot. */
  gpuSlotBusy(): boolean {
    return this.gpuProofBusy || (this.localBackend === 'gpu' && this.local.state() !== 'cold');
  }

  /** Retires an idle GPU worker before a new explicit setup check. */
  retireIdleGpu(): void {
    if (this.current === undefined && this.localBackend === 'gpu' && this.local.state() === 'ready') {
      this.local.retire('worker_exit');
    }
  }

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
    // specs/GpuSetup.tla, ExplicitNoFallback: explicit GPU must never fall back to the CPU worker.
    const computeMode = this.options.computeMode?.() ?? 'cpu';
    if (
      provider === 'kokoro' &&
      computeMode === 'gpu' &&
      (this.options.gpuCapability === undefined || this.options.createGpu === undefined)
    ) {
      this.options.output.status(id, 'unavailable', 'GPU speech is not available. Check GPU setup.');
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
    // specs/SpeechTempo.tla, Admit: a transformed unit waits for the previous transform worker to retire.
    const listeningRate = speechListeningRate(settings.listeningSpeed);
    if (
      (provider === 'kokoro' && (this.gpuProofBusy || this.options.gpuExternalBusy?.() === true)) ||
      this.local.busy() ||
      this.local.state() === 'retiring' ||
      this.cloudBusy !== undefined ||
      (listeningRate !== 1 && this.options.tempo?.busy() === true)
    ) {
      this.options.output.status(id, 'unavailable', 'Speech is still finishing; try again shortly.');
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    const current: ActiveSpeech = {
      id,
      text,
      parts: provider === 'kokoro' && this.options.output.parts === true ? speechSegments(text) : [text],
      multipart: false,
      nextPart: 0,
      part: 0,
      lookaheadAllowed: false,
      aggregateMs: 0,
      // specs/SpeechTempo.tla, Select: the unit samples its listening rate once, here.
      listeningRate,
      provider,
      computeMode,
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
    current.multipart = current.parts.length > 1;
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
      this.armStartup(current, START_TIMEOUT_MS);
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
      this.failCloud(current, 'unknown');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (this.cloudBusy?.id !== current.id) return;
      controller.abort();
      this.cloudBusy = undefined;
      if (this.current === current) this.failCloud(current, 'timeout');
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
          this.receiveAudio(current, 0, audio, true);
        },
        (error: unknown) => {
          release();
          if (this.current === current) this.failCloud(current, cloudFailureReason(error));
        },
      );
    } catch (error: unknown) {
      release();
      this.failCloud(current, cloudFailureReason(error));
    }
  }

  private failCloud(current: ActiveSpeech, reason: CloudSpeechFailureReason): void {
    if (this.current !== current) return;
    try {
      this.options.cloudDiagnostic?.(reason);
    } catch {
      /* Observability must not change speech behavior. */
    }
    if (reason === 'canceled') this.finish(current);
    else this.fail(current, cloudFailureMessage(reason));
  }

  /** A credential change invalidates current cloud audio and pending requests. */
  invalidateCloud(): void {
    this.cloudBusy?.controller.abort();
    if (this.current?.provider === 'elevenlabs') this.cancel();
  }

  private async start(current: ActiveSpeech): Promise<void> {
    if (current.computeMode !== 'cpu' && this.options.gpuCapability !== undefined && this.options.createGpu !== undefined) {
      await this.startGpu(current);
      return;
    }
    if (current.computeMode === 'auto') this.options.gpuCheck?.({ phase: 'unavailable', reason: 'runtime_missing' });
    this.startCpu(current);
  }

  /** Switches only after the previous worker has been reaped. */
  private startCpu(current: ActiveSpeech): void {
    if (this.localBackend === 'gpu') {
      if (this.local.state() !== 'cold') {
        this.local.retire('worker_exit');
        this.fail(current, 'Speech is still finishing; try again shortly.');
        return;
      }
      this.local = this.cpuLocal;
      this.localBackend = 'cpu';
    }
    void this.startCpuWorker(current);
  }

  /** Requests fresh capability before creating a new isolated GPU worker. */
  private async startGpu(current: ActiveSpeech): Promise<void> {
    if (this.localBackend === 'gpu' && this.local.state() === 'ready') {
      this.synthesize(current);
      return;
    }
    if (this.local.state() !== 'cold') {
      this.local.retire('worker_exit');
      this.fail(current, 'Speech is still finishing; try again shortly.');
      return;
    }
    let result: GpuCapabilityResult | undefined;
    this.armStartup(current, GPU_PROOF_TIMEOUT_MS);
    this.gpuProofBusy = true;
    try {
      // specs/GpuSynthesisProcess.tla, Spawn: each GPU worker requires fresh proof.
      result = await this.options.gpuCapability?.();
    } catch (error) {
      if (this.current !== current) return;
      if (error instanceof GpuProcessBusyError) {
        this.fail(current, 'Speech is still finishing; try again shortly.');
        return;
      }
      this.options.gpuCheck?.({ phase: 'unavailable', reason: 'probe_failed' });
      if (current.computeMode === 'auto') {
        this.armStartup(current, START_TIMEOUT_MS);
        this.startCpu(current);
      } else this.fail(current, 'GPU speech is not available. Check GPU setup.');
      return;
    } finally {
      // specs/GpuSynthesisProcess.tla, Reap: proof owns its slot until it settles.
      this.gpuProofBusy = false;
    }
    if (this.current !== current) return;
    if (result?.check.phase === 'checking' || (result?.check.phase === 'unavailable' && result.check.reason === 'busy')) {
      this.fail(current, 'Speech is still finishing; try again shortly.');
      return;
    }
    if (result?.check.phase !== 'ready' || result.capability === undefined || this.options.createGpu === undefined) {
      const check: Extract<GpuCheck, { phase: 'unavailable' }> =
        result?.check.phase === 'unavailable' ? result.check : { phase: 'unavailable', reason: 'inconclusive' };
      this.options.gpuCheck?.(check);
      if (current.computeMode === 'auto') {
        this.armStartup(current, START_TIMEOUT_MS);
        this.startCpu(current);
      } else this.fail(current, 'GPU speech is not available. Check GPU setup.');
      return;
    }
    try {
      const listener: LocalListener = {
        ready: () => {
          this.localReady();
        },
        retired: (reason) => {
          this.localRetired(reason);
        },
      };
      this.armStartup(current, START_TIMEOUT_MS);
      this.local = this.options.createGpu(result.capability, listener);
      this.localBackend = 'gpu';
      this.local.load(result.capability.modelDirectory);
    } catch (error) {
      this.local.retire('worker_error');
      if (this.current === current) {
        this.fail(
          current,
          error instanceof GpuProcessBusyError
            ? 'Speech is still finishing; try again shortly.'
            : 'GPU speech could not start. Check GPU setup.',
        );
      }
    }
  }

  private async startCpuWorker(current: ActiveSpeech): Promise<void> {
    const state = this.local.state();
    if (state === 'ready') {
      this.synthesize(current);
      return;
    }
    if (state !== 'cold') return;
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
      // specs/WarmSynthesisWorker.tla, Load: the checked model path comes from the host, never from input.
      this.local.load(modelPath);
    } catch (error: unknown) {
      if (this.current !== current) return;
      this.localDiagnostic('failed', localWorkerError(error));
      this.fail(current, 'Local speech could not start. Retry setup.');
    }
  }

  private synthesize(current: ActiveSpeech): void {
    if (this.current !== current || this.local.state() !== 'ready' || (this.paused && current.multipart)) return;
    const part = current.nextPart;
    // A bounded slice is empty if an internal ordinal is invalid; the client rejects it.
    const text = current.parts.slice(part, part + 1).join('');
    current.nextPart++;
    if (current.phase !== 'playing') current.phase = 'synthesizing';
    if (current.phase !== 'playing') this.clearTimer(current);
    // specs/SentencePipeline.tla, Synthesize: one inference owns its unit and part.
    void this.local
      .synthesize({ id: current.id, part, final: part === current.parts.length - 1, text, voice: current.voice, speed: current.speed })
      .then((outcome) => {
        this.localOutcome(current, part, outcome);
      });
  }

  /** Starts at most one lookahead after the prior part actually started. */
  private lookahead(current: ActiveSpeech): void {
    if (
      this.current !== current ||
      !current.multipart ||
      this.paused ||
      !current.lookaheadAllowed ||
      current.buffered !== undefined ||
      current.processing !== undefined ||
      this.local.busy() ||
      this.local.state() !== 'ready' ||
      current.nextPart >= current.parts.length
    ) {
      return;
    }
    this.synthesize(current);
  }

  /** The client reported valid capabilities: records the checkpoint and starts a unit that waits for it. */
  private localReady(): void {
    this.options.actualBackend?.(this.localBackend);
    const current = this.current;
    this.localDiagnostic('ready');
    if (current !== undefined && current.phase === 'loading') this.synthesize(current);
  }

  /** Applies one inference outcome to the unit that asked for it, if that unit is still current. */
  private localOutcome(current: ActiveSpeech, part: number, outcome: LocalSynthesisOutcome): void {
    // specs/SentencePipeline.tla, SynthDone: a stale outcome cannot touch another unit.
    if (this.current !== current) return;
    if (outcome.status === 'audio') {
      this.receiveAudio(current, part, outcome, part === current.parts.length - 1);
    } else {
      // A retirement already ended the unit through localRetired, and a cancellation is the
      // service's own, so a failure that reaches a current unit is a synthesis the client refused.
      this.localDiagnostic('failed', 'synthesis');
      this.fail(current, 'Could not speak this text. Continue reading it.');
    }
  }

  /** The worker was retired or exited: the unit it served is over, and nothing is replayed. */
  private localRetired(reason: LocalSpeechFailureReason): void {
    this.options.actualBackend?.('none');
    const current = this.current;
    if (current?.provider === 'kokoro') {
      this.localDiagnostic('failed', reason);
      this.fail(current, 'Local speech stopped. Retry setup.');
    }
  }

  /** Applies listening speed locally before exposing a waveform to playback. */
  private receiveAudio(current: ActiveSpeech, part: number, audio: { wav: Uint8Array; durationMs: number }, final: boolean): void {
    if (
      audio.wav.length < MIN_WAV_BYTES ||
      audio.wav.length > MAX_WAV_BYTES ||
      !Number.isFinite(audio.durationMs) ||
      audio.durationMs <= 0
    ) {
      this.fail(current, 'Generated speech was invalid; continue reading.');
      return;
    }
    if (current.listeningRate === 1) {
      this.acceptAudio(current, part, audio);
      return;
    }
    const tempo = this.options.tempo;
    if (tempo === undefined || current.processing !== undefined) {
      this.fail(current, 'Listening speed is unavailable; continue reading.');
      return;
    }
    // specs/SpeechTempo.tla, Transform: one unit and part own the one transform.
    const processing = { part, controller: new AbortController() };
    current.processing = processing;
    if (current.phase !== 'playing') current.phase = 'transforming';
    try {
      const pcm = decodeSpeechWav(audio.wav, final);
      void tempo.transform({ unitId: current.id, part, rate: current.listeningRate, pcm }, processing.controller.signal).then(
        (result) => {
          if (this.current !== current || current.processing !== processing || processing.controller.signal.aborted) return;
          current.processing = undefined;
          try {
            this.acceptAudio(current, part, encodeTempoWav(result, final));
          } catch {
            this.fail(current, 'Listening speed is unavailable; continue reading.');
          }
        },
        () => {
          if (this.current === current && current.processing === processing) {
            current.processing = undefined;
            this.fail(current, 'Listening speed is unavailable; continue reading.');
          }
        },
      );
    } catch {
      if (this.current === current) {
        current.processing = undefined;
        this.fail(current, 'Listening speed is unavailable; continue reading.');
      }
    }
  }

  /** Bounds the complete transformed unit and buffers at most one next part. */
  private acceptAudio(current: ActiveSpeech, part: number, audio: { wav: Uint8Array; durationMs: number }): void {
    // specs/SpeechTempo.tla, Result and Play: duration and the aggregate bound come from the transformed samples.
    if (
      audio.wav.length < MIN_WAV_BYTES ||
      audio.wav.length > MAX_WAV_BYTES ||
      !Number.isFinite(audio.durationMs) ||
      audio.durationMs <= 0 ||
      current.aggregateMs + audio.durationMs > MAX_DURATION_MS
    ) {
      this.fail(current, 'Generated speech was invalid; continue reading.');
      return;
    }
    current.aggregateMs += audio.durationMs;
    if (current.phase === 'playing') {
      current.buffered = { part, wav: audio.wav, durationMs: audio.durationMs };
      return;
    }
    current.part = part;
    current.wav = audio.wav;
    current.durationMs = audio.durationMs;
    current.phase = 'prepared';
    this.clearTimer(current);
    if (this.paused) this.options.output.status(current.id, 'paused');
    else this.play(current);
  }

  private play(current: ActiveSpeech): void {
    if (current.multipart) current.lookaheadAllowed = false;
    this.options.output.status(current.id, 'preparing');
    if (this.current !== current) return;
    let pageId: number | undefined;
    try {
      pageId = current.multipart
        ? this.options.output.play(current.id, current.wav, current.durationMs, current.part)
        : this.options.output.play(current.id, current.wav, current.durationMs);
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
    if (
      current === undefined ||
      current.id !== event.id ||
      current.pageId !== event.pageId ||
      current.phase !== 'playing' ||
      (event.part ?? 0) !== current.part
    ) {
      return undefined;
    }
    if (event.event === 'failed') {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Audio could not play. Use Preview voice to enable audio.');
      return 'failed';
    } else if (event.event === 'ended') {
      if (current.multipart && !current.started) {
        this.fail(current, 'Audio could not play. Use Preview voice to enable audio.');
        return 'failed';
      }
      if (current.multipart && current.part < current.parts.length - 1) {
        // specs/SentencePipeline.tla, Close: intermediate retirement never completes the unit.
        this.clearTimer(current);
        current.started = false;
        const buffered = current.buffered;
        current.buffered = undefined;
        current.phase = buffered === undefined ? (current.processing === undefined ? 'synthesizing' : 'transforming') : 'prepared';
        if (buffered !== undefined) {
          current.part = buffered.part;
          current.wav = buffered.wav;
          current.durationMs = buffered.durationMs;
          current.lookaheadAllowed = false;
          if (!this.paused) this.play(current);
        } else this.lookahead(current);
        return undefined;
      }
      this.finish(current);
      return 'ended';
    } else {
      if (current.started) return undefined;
      current.started = true;
      current.remaining = current.durationMs + PLAYBACK_GRACE_MS;
      if (!this.paused) this.arm(current, current.remaining);
      this.options.output.status(current.id, this.paused ? 'paused' : 'speaking');
      current.lookaheadAllowed = true;
      this.lookahead(current);
      return undefined;
    }
  }

  /** Pauses current playback and its watchdog without advancing reading. */
  pause(): void {
    this.paused = true;
    const current = this.current;
    if (current === undefined) return;
    if (current.multipart && current.phase === 'loading') this.freeze(current);
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
      this.lookahead(current);
    } else {
      if (current.phase === 'loading' && this.local.state() === 'ready') this.synthesize(current);
      else {
        if (current.multipart && current.phase === 'loading') this.arm(current, current.remaining);
        this.lookahead(current);
      }
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
    void this.options.tempo?.dispose().catch(() => {});
    this.local.retire('worker_error');
  }

  private armStartup(current: ActiveSpeech, ms: number): void {
    this.clearTimer(current);
    current.remaining = ms;
    if (!this.paused || !current.multipart) this.arm(current, ms);
  }

  private arm(current: ActiveSpeech, ms: number): void {
    this.clearTimer(current);
    current.remaining = ms;
    current.deadline = Date.now() + ms;
    current.timer = setTimeout(() => {
      const state = this.local.state();
      if ((current.phase === 'loading' || current.phase === 'synthesizing') && (state === 'loading' || state === 'ready')) {
        // specs/WarmSynthesisWorker.tla, Retire: the unit's deadline also retires a worker that is still busy.
        this.local.retire('timeout');
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
    // specs/SpeechTempo.tla, Cancel: abort invalidates the transform; the worker slot retires on its own.
    current.processing?.controller.abort();
    // specs/WarmSynthesisWorker.tla, Cancel: the result is invalid now; the worker stays owned until it returns.
    this.local.cancel();
    this.clearTimer(current);
    if (current.pageId !== undefined) this.options.output.control(current.id, current.pageId, 'stop');
    else this.options.output.cancel?.(current.id);
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
}
