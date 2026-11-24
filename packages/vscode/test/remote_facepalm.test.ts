import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AUDIO_VERSION, localAudioFrame, type LocalAudioFrame } from '@ai-pair/protocol';
import { RemoteFacepalm } from '../src/remote_facepalm';

afterEach(() => vi.useRealTimers());

describe('RemoteFacepalm', () => {
  it('CardsCurrent: rejects old replies after retirement even with a new beat', async () => {
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        expect(localAudioFrame.safeParse(frame).success).toBe(true);
        sent.push(frame);
      },
    });
    const first = proxy.markBeat('question', 1500);
    const old = sent[0];
    if (old?.type !== 'facepalmBeat') throw new Error('missing beat');
    proxy.retire();
    expect(await first).toBeUndefined();
    const second = proxy.markBeat('proposal', 1500);
    const current = sent.at(-1);
    if (current?.type !== 'facepalmBeat') throw new Error('missing successor');
    const cue = { id: 1, feeling: 'agreement' as const, feelings: ['agreement' as const] };
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmResult',
      pageEpoch: 1,
      generation: old.generation,
      requestId: old.requestId,
      cue,
    });
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmResult',
      pageEpoch: 1,
      generation: current.generation,
      requestId: current.requestId,
      cue,
    });
    expect(await second).toEqual(cue);
    proxy.dispose();
  });
  it('Settlement: timeout retires the generation and resolves the request', async () => {
    vi.useFakeTimers();
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    const result = proxy.markBeat('question', 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBeUndefined();
    expect(sent.at(-1)?.type).toBe('facepalmRetire');
    proxy.dispose();
  });
  it('bounds admission to one outstanding beat', async () => {
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    const first = proxy.markBeat('question', 10);
    expect(await proxy.markBeat('proposal', 10)).toBeUndefined();
    expect(sent).toHaveLength(1);
    proxy.retire();
    await first;
    proxy.dispose();
  });

  it('forwards local settings, status, feedback and refuses work after disposal', async () => {
    const sent: LocalAudioFrame[] = [];
    let page: number | undefined = 1;
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => page,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        expect(localAudioFrame.safeParse(frame).success).toBe(true);
        sent.push(frame);
      },
    });
    const onStatus = vi.fn<(snapshot: import('@ai-pair/protocol').FacepalmSnapshot) => void>();
    const snapshot = { enabled: false, status: 'off' as const, available: true, canOpenSettings: false };
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1, type: 'facepalmStatus', snapshot });
    proxy.onStatus = onStatus;
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 2, type: 'facepalmStatus', snapshot });
    expect(proxy.snapshot()).toEqual(snapshot);
    expect(onStatus).toHaveBeenCalledWith(snapshot);
    expect(await proxy.markBeat('question', 1)).toBeUndefined();
    proxy.setEnabled(false);
    proxy.setEnabled(true);
    proxy.refresh();
    proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmStatus',
      snapshot: { ...snapshot, enabled: true, status: 'idle' },
    });
    await proxy.feel(1, 'agreement');
    expect(sent.map((frame) => frame.type)).toEqual([
      'facepalmRetire',
      'facepalmEnabled',
      'facepalmEnabled',
      'facepalmRefresh',
      'facepalmOpenSettings',
      'facepalmFeel',
    ]);
    page = undefined;
    expect(await proxy.markBeat('question', 1)).toBeUndefined();
    await proxy.feel(1, 'agreement');
    proxy.dispose();
    proxy.dispose();
    proxy.setEnabled(false);
    proxy.refresh();
    proxy.openSettings();
    expect(await proxy.markBeat('question', 1)).toBeUndefined();
    expect(sent).toHaveLength(6);
  });
  it('rejects mismatched attachment, page, generation and request identities', async () => {
    const sent: LocalAudioFrame[] = [];
    let page = 1;
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => page,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    const answer = proxy.markBeat('question', 1);
    const result: Extract<LocalAudioFrame, { type: 'facepalmResult' }> = {
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmResult' as const,
      pageEpoch: 1,
      generation: 1,
      requestId: 1,
    };
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1, type: 'heartbeat' });
    proxy.accept({ ...result, connectionEpoch: 'other' });
    proxy.accept({ ...result, requestId: 2 });
    proxy.accept({ ...result, generation: 2 });
    proxy.accept({ ...result, pageEpoch: 2 });
    page = 2;
    proxy.accept(result);
    page = 1;
    proxy.accept(result);
    expect(await answer).toBeUndefined();
    proxy.dispose();
    proxy.accept(result);
  });
  it('keeps the channel usable when a status observer throws', async () => {
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    proxy.onStatus = () => {
      throw new Error('observer');
    };
    expect(() => {
      proxy.accept({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: 'a',
        sequence: 1,
        type: 'facepalmStatus',
        snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true },
      });
    }).not.toThrow();
    const result = proxy.markBeat('question', 1);
    proxy.retire();
    expect(await result).toBeUndefined();
    expect(sent.map((frame) => frame.type)).toEqual(['facepalmBeat', 'facepalmRetire']);
    proxy.dispose();
  });
});
