/** The cue is a quiet 100 ms sine wave with a smooth fade at each end. */
const SAMPLE_RATE = 16_000;
const SAMPLE_COUNT = 1600;
const FREQUENCY = 660;
const AMPLITUDE = 1800;
const HEADER = 44;
const PCM_BYTES = 2;
// PCM WAV header offsets and values.
// oxlint-disable-next-line eslint/no-magic-numbers
const WAV = {
  riffSize: 4,
  riffPrefix: 8,
  wave: 8,
  format: 12,
  formatSize: 16,
  pcm: 20,
  channels: 22,
  rate: 24,
  byteRate: 28,
  alignment: 32,
  bits: 34,
  data: 36,
  dataSize: 40,
  formatBytes: 16,
  sampleBits: 16,
} as const;

/** Builds the short, quiet sound locally without downloading an asset. */
function cueWave(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER + SAMPLE_COUNT * PCM_BYTES);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [WAV.wave, 'WAVE'],
    [WAV.format, 'fmt '],
    [WAV.data, 'data'],
  ] as const) {
    bytes.set(new TextEncoder().encode(text), offset);
  }
  view.setUint32(WAV.riffSize, bytes.length - WAV.riffPrefix, true);
  view.setUint32(WAV.formatSize, WAV.formatBytes, true);
  view.setUint16(WAV.pcm, 1, true);
  view.setUint16(WAV.channels, 1, true);
  view.setUint32(WAV.rate, SAMPLE_RATE, true);
  view.setUint32(WAV.byteRate, SAMPLE_RATE * PCM_BYTES, true);
  view.setUint16(WAV.alignment, PCM_BYTES, true);
  view.setUint16(WAV.bits, WAV.sampleBits, true);
  view.setUint32(WAV.dataSize, SAMPLE_COUNT * PCM_BYTES, true);
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const fade = Math.sin((Math.PI * index) / SAMPLE_COUNT);
    const sample = Math.sin((2 * Math.PI * FREQUENCY * index) / SAMPLE_RATE) * fade * AMPLITUDE;
    view.setInt16(HEADER + index * PCM_BYTES, Math.round(sample), true);
  }
  return bytes;
}

interface Clip {
  url: string;
  listeners: AbortController;
  player: HTMLAudioElement;
}

/** Owns the approval cue separately from the narration audio player. */
export class ApprovalSound {
  private player?: HTMLAudioElement;
  private clip?: Clip;

  private audio(): HTMLAudioElement {
    this.player ??= new Audio();
    return this.player;
  }

  /** Unlocks the cue player during a user gesture when the browser requires one. */
  unlock(): void {
    try {
      const player = this.audio();
      if (!player.paused) return;
      void player.play().catch(() => {});
      player.pause();
    } catch {
      // Audio is optional; a blocked cue never blocks the Pair panel.
    }
  }

  /** Plays one cue without changing the narration player. */
  play(): void {
    try {
      const player = this.audio();
      player.pause();
      this.retire();
      const listeners = new AbortController();
      const url = URL.createObjectURL(new Blob([cueWave().buffer], { type: 'audio/wav' }));
      const clip = { url, listeners, player };
      this.clip = clip;
      const done = (): void => {
        this.retire(clip);
      };
      player.addEventListener('ended', done, { signal: listeners.signal });
      player.addEventListener('error', done, { signal: listeners.signal });
      player.src = url;
      void player.play().catch(done);
    } catch {
      this.retire();
    }
  }

  /** Releases the player and any live cue when the panel goes away. */
  dispose(): void {
    this.player?.pause();
    this.retire();
    this.player = undefined;
  }

  /** Retires only the current clip, ignoring late failures from an older cue. */
  private retire(clip = this.clip): void {
    if (clip === undefined || this.clip !== clip) return;
    this.clip = undefined;
    clip.listeners.abort();
    URL.revokeObjectURL(clip.url);
    clip.player.removeAttribute('src');
  }
}
