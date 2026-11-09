import type {
  GpuCheck,
  GpuCheckProgress,
  GpuUnavailableReason,
  SpeechComputeBackend,
  SpeechComputeMode,
  SpeechComputeState,
} from './speech_compute_types';

/** Owns the requested compute setting and the observed local worker state. */
export class SpeechCompute {
  private value: SpeechComputeState;
  private checking = false;

  constructor(
    requested: unknown,
    private readonly probe: (progress: (value: GpuCheckProgress) => void) => Promise<GpuCheck>,
    private readonly changed: (value: SpeechComputeState) => void,
    private readonly allowReady = false,
  ) {
    this.value = {
      requestedMode: requested === 'auto' || requested === 'gpu' ? requested : 'cpu',
      actualBackend: 'none',
      gpuCheck: { phase: 'idle' },
    };
  }

  /** Returns the current state. */
  state(): SpeechComputeState {
    return this.value;
  }

  /** Selects the mode for the next speech unit. */
  select(requestedMode: SpeechComputeMode): void {
    this.value = { ...this.value, requestedMode };
    this.changed(this.value);
  }

  /** Records the worker actually in use. */
  actual(actualBackend: SpeechComputeBackend): void {
    this.value = { ...this.value, actualBackend };
    this.changed(this.value);
  }

  /** Reports why Auto could not use GPU without overwriting an active check. */
  reportUnavailable(reason: GpuUnavailableReason): void {
    if (this.checking) return;
    this.value = { ...this.value, gpuCheck: { phase: 'unavailable', reason } };
    this.changed(this.value);
  }

  /** Runs one explicit check; proof alone cannot enable an unavailable inference worker. */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.value = { ...this.value, gpuCheck: { phase: 'checking' } };
    this.changed(this.value);
    let gpuCheck: GpuCheck;
    let active = true;
    try {
      const result = await this.probe((progress) => {
        if (!active) return;
        this.value = { ...this.value, gpuCheck: { phase: 'checking', progress } };
        this.changed(this.value);
      });
      gpuCheck = result.phase === 'ready' && !this.allowReady ? { phase: 'unavailable', reason: 'inconclusive' } : result;
    } catch {
      gpuCheck = { phase: 'unavailable', reason: 'probe_failed' };
    }
    active = false;
    this.checking = false;
    this.value = { ...this.value, gpuCheck };
    this.changed(this.value);
  }
}
