import type { GpuCheck, SpeechComputeBackend, SpeechComputeMode, SpeechComputeState } from './speech_compute_types';

/** Owns the requested compute setting and the observed local worker state. */
export class SpeechCompute {
  private value: SpeechComputeState;
  private checking = false;

  constructor(
    requested: unknown,
    private readonly probe: () => Promise<GpuCheck>,
    private readonly changed: (value: SpeechComputeState) => void,
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

  /** Runs one explicit check; proof alone cannot enable an unavailable inference worker. */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.value = { ...this.value, gpuCheck: { phase: 'checking' } };
    this.changed(this.value);
    let gpuCheck: GpuCheck;
    try {
      const result = await this.probe();
      gpuCheck = result.phase === 'ready' ? { phase: 'unavailable', reason: 'runtime_missing' } : result;
    } catch {
      gpuCheck = { phase: 'unavailable', reason: 'probe_failed' };
    }
    this.checking = false;
    this.value = { ...this.value, gpuCheck };
    this.changed(this.value);
  }
}
