/** The requested local speech compute mode. */
export type SpeechComputeMode = 'cpu' | 'auto' | 'gpu';
/** The backend actually used for local speech. */
export type SpeechComputeBackend = 'none' | 'cpu' | 'gpu';
/** Fixed, safe explanations for an unavailable GPU. */
export type GpuUnavailableReason =
  | 'busy'
  | 'unsupported'
  | 'runtime_missing'
  | 'untrusted_driver'
  | 'no_hardware'
  | 'inconclusive'
  | 'model_missing'
  | 'probe_failed'
  | 'timeout';
/** Progress reported during the explicitly requested setup check. */
export interface GpuCheckProgress {
  stage: 'download' | 'verify' | 'check';
  current?: number;
  total?: number;
}
/** The result of the GPU setup check. */
export type GpuCheck =
  { phase: 'idle' | 'ready' } | { phase: 'checking'; progress?: GpuCheckProgress } | { phase: 'unavailable'; reason: GpuUnavailableReason };
/** The compute choice and the backend actually in use. */
export interface SpeechComputeState {
  phase?: 'cold' | 'checking' | 'loading' | 'ready' | 'retiring' | 'failed' | 'disposed';
  failureReason?: import('./speech_types').LocalSpeechFailureReason;
  requestedMode: SpeechComputeMode;
  actualBackend: SpeechComputeBackend;
  gpuCheck: GpuCheck;
}
