/** Largest number of waveform parts in one admitted unit. */
export const MAX_AUDIO_PARTS = 4;

/** Ownership is scoped to one connection, job, and webview page. */
export interface AudioOwner {
  connectionEpoch: string;
  jobId: string;
  pageEpoch: number;
}

export type AudioChoice = { kind: 'default' } | { kind: 'device'; id: string };
export interface AudioCapabilities {
  backend: string;
  location: 'ui';
  defaultOutput: boolean;
  deviceSelection: boolean;
  pauseResume: boolean;
}
export interface AudioDevice {
  id: string;
  label: string;
}
export type AudioLease = string & { readonly __audioLease: unique symbol };
export interface AudioEvent {
  owner: AudioOwner;
  sequence: number;
  /** Zero-based part ordinal within this admitted unit. */
  part: number;
  type: 'started' | 'ended' | 'canceled' | 'failed';
}
export interface AudioAdapter {
  capabilities(): Promise<AudioCapabilities>;
  list(): Promise<AudioDevice[]>;
  admit(owner: AudioOwner, choice: AudioChoice): Promise<AudioLease>;
  play(lease: AudioLease, wav: Uint8Array, part?: number): Promise<void>;
  pause(owner: AudioOwner): Promise<void>;
  resume(owner: AudioOwner): Promise<void>;
  stop(owner: AudioOwner): Promise<void>;
  onEvent(listener: (event: AudioEvent) => void): { dispose(): void };
}
