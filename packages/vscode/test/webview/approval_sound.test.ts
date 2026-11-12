import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The root typecheck has no DOM library; the webview typecheck owns this module.
const SCRIPT = '../../src/webview/approval_sound';
interface Sound {
  play(): void;
  unlock(): void;
  dispose(): void;
}
let ApprovalSound: new () => Sound;

function hasApprovalSound(value: unknown): value is { ApprovalSound: new () => Sound } {
  return typeof value === 'object' && value !== null && 'ApprovalSound' in value && typeof value.ApprovalSound === 'function';
}

class FakeAudio {
  paused = true;
  src = '';
  readonly listeners = new Map<string, () => void>();
  readonly play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly pause = vi.fn<() => void>();
  readonly removeAttribute = vi.fn<(name: string) => void>();
  readonly addEventListener = vi.fn<(type: string, listener: () => void) => void>((type, listener) => {
    this.listeners.set(type, listener);
  });
}

let player: FakeAudio;
let created: Blob | undefined;
let nextUrl: number;
const createObjectURL = vi.fn<(value: Blob) => string>((value) => {
  created = value;
  return `blob:${++nextUrl}`;
});
const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(async () => {
  const module: unknown = await import(/* @vite-ignore */ SCRIPT);
  if (!hasApprovalSound(module)) throw new TypeError('The approval sound module has no constructor');
  ApprovalSound = module.ApprovalSound;
  nextUrl = 0;
  created = undefined;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  player = new FakeAudio();
  // The browser constructs Audio with `new`.
  // oxlint-disable-next-line typescript/no-extraneous-class
  class AudioConstructor {
    constructor() {
      return player;
    }
  }
  vi.stubGlobal('Audio', AudioConstructor);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApprovalSound', () => {
  it('plays a short local WAV and releases it after playback', async () => {
    const sound = new ApprovalSound();
    sound.play();
    const blob = created;
    if (blob === undefined) throw new Error('Cue WAV was not created');
    expect(blob.type).toBe('audio/wav');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    const wav = new DataView(bytes.buffer);
    expect(wav.getUint32(24, true)).toBe(16_000);
    expect(wav.getUint32(40, true)).toBe(3200);
    expect(bytes.subarray(44).some((sample) => sample !== 0)).toBe(true);
    expect(player.src).toBe('blob:1');
    expect(player.play).toHaveBeenCalledOnce();
    player.listeners.get('ended')?.();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1');
    sound.dispose();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('unlocks on a gesture without interrupting an already playing cue', async () => {
    const sound = new ApprovalSound();
    sound.unlock();
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.pause).toHaveBeenCalledOnce();
    player.paused = false;
    sound.unlock();
    expect(player.play).toHaveBeenCalledOnce();
    player.paused = true;
    player.play.mockRejectedValueOnce(new Error('blocked'));
    sound.unlock();
    await Promise.resolve();
    expect(player.pause).toHaveBeenCalledTimes(2);
  });

  it('retires the prior cue and ignores its late playback rejection', async () => {
    const old = Promise.withResolvers<void>();
    player.play.mockReturnValueOnce(old.promise).mockResolvedValueOnce();
    const sound = new ApprovalSound();
    sound.play();
    sound.play();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1');
    old.reject(new Error('old cue'));
    await Promise.resolve();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    player.listeners.get('error')?.();
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:2');
  });

  it('releases an interrupted cue on dispose and swallows playback failures', async () => {
    new ApprovalSound().dispose();
    const sound = new ApprovalSound();
    player.play.mockRejectedValueOnce(new Error('blocked'));
    sound.play();
    await Promise.resolve();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1');
    sound.play();
    sound.dispose();
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:2');
    sound.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('contains synchronous audio setup failures', () => {
    const sound = new ApprovalSound();
    player.play.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(() => {
      sound.unlock();
    }).not.toThrow();
    createObjectURL.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    expect(() => {
      sound.play();
    }).not.toThrow();
    player.play.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(() => {
      sound.play();
    }).not.toThrow();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1');
  });
});
