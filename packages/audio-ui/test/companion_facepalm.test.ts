import { describe, expect, it, vi } from 'vitest';
import { LOCAL_AUDIO_VERSION, type LocalAudioFrame } from '@ai-pair/protocol';
import { CompanionFacepalm } from '../src/companion_facepalm';

describe('CompanionFacepalm', () => {
  it('CardsCurrent: drops a late answer after retirement and allows the successor', async () => {
    let answer: ((value: undefined) => void) | undefined;
    const client = {
      markBeat: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue(undefined),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn(),
      snapshot: vi.fn(),
    };
    const sent: LocalAudioFrame[] = [];
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: vi.fn<() => void>(),
    });
    const frame = {
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      pageEpoch: 1,
      generation: 1,
      type: 'facepalmBeat' as const,
      requestId: 1,
      kind: 'question' as const,
      windowMs: 1500,
    };
    bridge.accept(frame);
    bridge.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 2, pageEpoch: 1, generation: 1, type: 'facepalmRetire' });
    answer?.(undefined);
    await Promise.resolve();
    expect(sent).toEqual([]);
    bridge.accept({ ...frame, sequence: 3, generation: 2, requestId: 2 });
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ type: 'facepalmResult', generation: 2, requestId: 2 });
  });
  it('never forwards an unbounded cue from the local service', async () => {
    const client = {
      markBeat: vi.fn().mockResolvedValue({ id: 1, feeling: 'unknown', feelings: Array.from({ length: 100 }, () => 'unknown') }),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn(),
    };
    const sent: LocalAudioFrame[] = [];
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: vi.fn<() => void>(),
    });
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      pageEpoch: 1,
      generation: 1,
      type: 'facepalmBeat',
      requestId: 1,
      kind: 'question',
      windowMs: 1,
    });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('cue');
  });

  it('accepts current controls and rejects stale page, generation, epoch and closed work', async () => {
    let page: number | undefined = 1;
    const client = {
      markBeat: vi.fn().mockResolvedValue(undefined),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const openSettings = vi.fn<() => void>();
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => page,
      nextSequence: () => 1,
      send: vi.fn<(frame: LocalAudioFrame) => void>(),
      openSettings,
    });
    const base = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1 };
    bridge.accept({ ...base, type: 'facepalmEnabled', enabled: false });
    bridge.accept({ ...base, type: 'facepalmRefresh' });
    bridge.accept({ ...base, type: 'facepalmOpenSettings' });
    expect(client.setEnabled).toHaveBeenCalledWith(false);
    expect(client.refresh).toHaveBeenCalledWith(false);
    expect(openSettings).toHaveBeenCalledOnce();
    const feel = { ...base, type: 'facepalmFeel' as const, pageEpoch: 1, generation: 1, id: 1, feeling: 'agreement' as const };
    bridge.accept(feel);
    expect(client.feel).toHaveBeenCalledWith(1, 'agreement');
    bridge.accept({ ...base, type: 'heartbeat' });
    bridge.accept({ ...feel, connectionEpoch: 'other' });
    bridge.accept({ ...feel, pageEpoch: 2 });
    bridge.accept({ ...feel, generation: 2 });
    expect(client.retire).toHaveBeenCalledOnce();
    bridge.accept(feel);
    expect(client.feel).toHaveBeenCalledTimes(2);
    page = undefined;
    bridge.accept({ ...feel, generation: 2 });
    await bridge.dispose();
    await bridge.dispose();
    bridge.accept({ ...base, type: 'facepalmRefresh' });
    expect(client.refresh).toHaveBeenCalledOnce();
  });
});
