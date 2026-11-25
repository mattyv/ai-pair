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
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1, type: 'facepalmStatus', pageEpoch: 1, snapshot });
    proxy.onStatus = onStatus;
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 2, type: 'facepalmStatus', pageEpoch: 1, snapshot });
    expect(proxy.snapshot()).toEqual(snapshot);
    expect(onStatus).toHaveBeenCalledWith(snapshot);
    expect(await proxy.markBeat('question', 1)).toBeUndefined();
    proxy.setEnabled(false);
    proxy.setEnabled(true);
    const recheck = proxy.refresh();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 3,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: { operation: 'recheck', outcome: { state: 'checked', snapshot } },
    });
    await recheck;
    const opening = proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 4,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 2,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    await opening;
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmStatus',
      pageEpoch: 1,
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
    await proxy.refresh();
    await proxy.openSettings();
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
        pageEpoch: 1,
        snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true },
      });
    }).not.toThrow();
    const result = proxy.markBeat('question', 1);
    proxy.retire();
    expect(await result).toBeUndefined();
    expect(sent.map((frame) => frame.type)).toEqual(['facepalmBeat', 'facepalmRetire']);
    proxy.dispose();
  });
  it('Settles: returns the correlated local launch failure and ignores stale replies', async () => {
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    const outcome = proxy.openSettings();
    const command = sent.at(-1);
    expect(command).toMatchObject({ type: 'facepalmOpenSettings', pageEpoch: 1, requestId: 1 });
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 2,
      result: { operation: 'open', outcome: { state: 'failed', reason: 'qt' } },
    });
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: { operation: 'open', outcome: { state: 'failed', reason: 'display' } },
    });
    expect(await outcome).toEqual({ state: 'failed', reason: 'display' });
    proxy.dispose();
  });

  it('CurrentPublication: page replacement drops old results and late diagnostics', async () => {
    let page = 1;
    const sent: LocalAudioFrame[] = [];
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => page,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
    });
    const old = proxy.openSettings();
    proxy.pageChanged();
    expect(await old).toBeUndefined();
    page = 2;
    const next = proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: { operation: 'open', outcome: { state: 'failed', reason: 'display' } },
    });
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmControlResult',
      pageEpoch: 2,
      requestId: 2,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    expect(await next).toEqual({ state: 'accepted' });
    const notice = vi.fn<(failure: Extract<import('@ai-pair/protocol').FacepalmSettingsLaunch, { state: 'failed' }>) => void>();
    proxy.onSettingsFailure = notice;
    const frame = {
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 3,
      type: 'facepalmSettingsNotice' as const,
      pageEpoch: 2,
      requestId: 2,
      failure: { state: 'failed' as const, reason: 'qt' as const },
    };
    proxy.accept(frame);
    expect(notice).toHaveBeenCalledOnce();
    proxy.pageChanged();
    page = 3;
    proxy.accept(frame);
    expect(notice).toHaveBeenCalledOnce();
    proxy.dispose();
  });
  it('Settles: controls fail on timeout, refused send, disconnect and concurrent work', async () => {
    vi.useFakeTimers();
    const proxy = new RemoteFacepalm({ epoch: 'a', page: () => 1, nextSequence: () => 1, send: () => Promise.resolve(true) });
    const first = proxy.openSettings();
    expect(await proxy.openSettings()).toEqual({ state: 'failed', reason: 'busy' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await first).toEqual({ state: 'failed', reason: 'timeout' });
    const second = proxy.openSettings();
    proxy.dispose();
    expect(await second).toEqual({ state: 'failed', reason: 'disconnected' });
    expect(await proxy.openSettings()).toEqual({ state: 'failed', reason: 'disconnected' });
    const refused = new RemoteFacepalm({ epoch: 'b', page: () => 1, nextSequence: () => 1, send: () => Promise.resolve(false) });
    expect(await refused.openSettings()).toEqual({ state: 'failed', reason: 'disconnected' });
    refused.dispose();
  });
  it('settles a recheck after send rejection and contains observer exceptions', async () => {
    const rejected = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => 1,
      send: () => Promise.reject(new Error('private')),
    });
    expect(rejected.currentPage()).toBe(1);
    expect(await rejected.refresh()).toEqual({ state: 'failed', reason: 'disconnected' });
    rejected.dispose();
    const thrown = new RemoteFacepalm({
      epoch: 'b',
      page: () => 1,
      nextSequence: () => 1,
      send: () => {
        throw new Error('private');
      },
    });
    expect(await thrown.openSettings()).toEqual({ state: 'failed', reason: 'disconnected' });
    thrown.dispose();
    const proxy = new RemoteFacepalm({ epoch: 'c', page: () => 1, nextSequence: () => 1, send: () => {} });
    proxy.onStatus = () => {
      throw new Error('observer');
    };
    const recheck = proxy.refresh();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'c',
      sequence: 1,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: {
        operation: 'recheck',
        outcome: { state: 'checked', snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true } },
      },
    });
    expect(await recheck).toBeUndefined();
    const opening = proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'c',
      sequence: 2,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 2,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    await opening;
    proxy.onSettingsFailure = () => {
      throw new Error('observer');
    };
    expect(() => {
      proxy.accept({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: 'c',
        sequence: 3,
        type: 'facepalmSettingsNotice',
        pageEpoch: 1,
        requestId: 2,
        failure: { state: 'failed', reason: 'qt' },
      });
    }).not.toThrow();
    proxy.dispose();
  });

  it('settles a beat when transport fails and ignores a predecessor failure', async () => {
    const send = Promise.withResolvers<boolean>();
    let calls = 0;
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => ++calls,
      send: (frame) => (frame.type === 'facepalmBeat' && calls === 1 ? send.promise : Promise.resolve(true)),
    });
    const old = proxy.markBeat('question', 1);
    proxy.retire();
    expect(await old).toBeUndefined();
    const successor = proxy.markBeat('question', 1);
    send.resolve(false);
    await Promise.resolve();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmResult',
      pageEpoch: 1,
      generation: 2,
      requestId: 2,
    });
    expect(await successor).toBeUndefined();
    proxy.dispose();
    const failed = new RemoteFacepalm({ epoch: 'b', page: () => 1, nextSequence: () => 1, send: () => Promise.resolve(false) });
    expect(await failed.markBeat('question', 1)).toBeUndefined();
    failed.dispose();
  });
  it('contains synchronous and asynchronous transport failures during retirement', async () => {
    const rejected = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => 1,
      send: () => Promise.reject(new Error('private')),
    });
    rejected.setEnabled(true);
    expect(await rejected.markBeat('question', 1)).toBeUndefined();
    rejected.dispose();
    const thrown = new RemoteFacepalm({
      epoch: 'b',
      page: () => 1,
      nextSequence: () => 1,
      send: () => {
        throw new Error('private');
      },
    });
    expect(await thrown.markBeat('question', 1)).toBeUndefined();
    thrown.dispose();
  });

  it('rejects predecessor status and late transport failure after settlement', async () => {
    let page: number | undefined;
    const send = Promise.withResolvers<boolean>();
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => page,
      nextSequence: () => 1,
      send: (frame) => (frame.type === 'facepalmOpenSettings' ? send.promise : undefined),
    });
    const snapshot = { enabled: true, status: 'idle' as const, available: true, canOpenSettings: true };
    proxy.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1, type: 'facepalmStatus', pageEpoch: 0, snapshot });
    expect(proxy.snapshot()).toEqual(snapshot);
    page = 2;
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmStatus',
      pageEpoch: 1,
      snapshot: { ...snapshot, status: 'off' },
    });
    expect(proxy.snapshot()).toEqual(snapshot);
    const opening = proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 3,
      type: 'facepalmControlResult',
      pageEpoch: 2,
      requestId: 1,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    expect(await opening).toEqual({ state: 'accepted' });
    send.resolve(false);
    await Promise.resolve();
    proxy.dispose();
  });
  it('allows delayed transport admission and a later result within the 20 second budget', async () => {
    vi.useFakeTimers();
    const admission = Promise.withResolvers<boolean>();
    const proxy = new RemoteFacepalm({
      epoch: 'a',
      page: () => 1,
      nextSequence: () => 1,
      send: (frame) => (frame.type === 'facepalmOpenSettings' ? admission.promise : Promise.resolve(true)),
    });
    const result = proxy.openSettings();
    await vi.advanceTimersByTimeAsync(6200);
    admission.resolve(true);
    await vi.advanceTimersByTimeAsync(8200);
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    expect(await result).toEqual({ state: 'accepted' });
    proxy.dispose();
  });

  it('CurrentNotice: starting a recheck immediately revokes the previous launch notice', async () => {
    const proxy = new RemoteFacepalm({ epoch: 'a', page: () => 1, nextSequence: () => 1, send: () => {} });
    const opening = proxy.openSettings();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 1,
      result: { operation: 'open', outcome: { state: 'accepted' } },
    });
    await opening;
    const notice = vi.fn<(failure: Extract<import('@ai-pair/protocol').FacepalmSettingsLaunch, { state: 'failed' }>) => void>();
    proxy.onSettingsFailure = notice;
    const recheck = proxy.refresh();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmSettingsNotice',
      pageEpoch: 1,
      requestId: 1,
      failure: { state: 'failed', reason: 'qt' },
    });
    expect(notice).not.toHaveBeenCalled();
    proxy.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 3,
      type: 'facepalmControlResult',
      pageEpoch: 1,
      requestId: 2,
      result: {
        operation: 'recheck',
        outcome: { state: 'checked', snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true } },
      },
    });
    await recheck;
    proxy.dispose();
  });
});
