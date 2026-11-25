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
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
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
      openSettings: vi.fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>().mockResolvedValue({ state: 'accepted' }),
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
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
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
      openSettings: vi.fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>().mockResolvedValue({ state: 'accepted' }),
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
      snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
    };
    const openSettings = vi
      .fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>()
      .mockResolvedValue({ state: 'accepted' });
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
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 1, requestId: 1 });
    await vi.waitFor(() => {
      expect(client.refresh).toHaveBeenCalledWith(false, false, false);
    });
    bridge.accept({ ...base, type: 'facepalmOpenSettings', pageEpoch: 1, requestId: 2 });
    await vi.waitFor(() => {
      expect(openSettings).toHaveBeenCalledOnce();
    });
    expect(client.setEnabled).toHaveBeenCalledWith(false);
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
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 1, requestId: 1 });
    expect(client.refresh).toHaveBeenCalledOnce();
  });
  it('CurrentPublication: sends only the current page correlated launch outcome', async () => {
    let page: number | undefined = 1;
    const launch = Promise.withResolvers<import('@ai-pair/protocol').FacepalmSettingsLaunch>();
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn(),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn(),
      snapshot: vi.fn(),
    };
    const sent: LocalAudioFrame[] = [];
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => page,
      nextSequence: () => 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: () => launch.promise,
    });
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmOpenSettings',
      pageEpoch: 1,
      requestId: 1,
    });
    await Promise.resolve();
    page = 2;
    launch.resolve({ state: 'failed', reason: 'display' });
    await Promise.resolve();
    expect(sent).toEqual([]);
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 2,
      type: 'facepalmOpenSettings',
      pageEpoch: 2,
      requestId: 2,
    });
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({
        type: 'facepalmControlResult',
        pageEpoch: 2,
        requestId: 2,
        result: { operation: 'open', outcome: { state: 'failed', reason: 'display' } },
      });
    });
  });

  it('returns a sanitized failure if the local launch effect throws synchronously', async () => {
    const sent: LocalAudioFrame[] = [];
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn(),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn(),
      snapshot: vi.fn(),
    };
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => 1,
      nextSequence: () => 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: () => {
        throw new Error('secret');
      },
    });
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmOpenSettings',
      pageEpoch: 1,
      requestId: 1,
    });
    await vi.waitFor(() => {
      expect(sent).toMatchObject([
        { type: 'facepalmControlResult', result: { operation: 'open', outcome: { state: 'failed', reason: 'start' } } },
      ]);
    });
  });
  it('scopes late launch diagnostics and an asynchronous recheck to their page', async () => {
    let page = 1;
    let late: ((failure: Extract<import('@ai-pair/protocol').FacepalmSettingsLaunch, { state: 'failed' }>) => void) | undefined;
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn(),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
    };
    const sent: LocalAudioFrame[] = [];
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => page,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: (report) => {
        late = report;
        return Promise.resolve({ state: 'accepted' });
      },
    });
    const base = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1 };
    bridge.accept({ ...base, type: 'facepalmOpenSettings', pageEpoch: 1, requestId: 1 });
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    late?.({ state: 'failed', reason: 'qt' });
    expect(sent.at(-1)).toMatchObject({ type: 'facepalmSettingsNotice', pageEpoch: 1, requestId: 1 });
    page = 2;
    late?.({ state: 'failed', reason: 'qt' });
    expect(sent).toHaveLength(2);
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 1, requestId: 2 });
    expect(client.refresh).not.toHaveBeenCalled();
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 2, requestId: 3 });
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({
        type: 'facepalmControlResult',
        pageEpoch: 2,
        requestId: 3,
        result: { operation: 'recheck', outcome: { state: 'checked' } },
      });
    });
    expect(client.markBeat).not.toHaveBeenCalled();
    await bridge.dispose();
  });
  it('reports a recheck failure and discards completion after page replacement', async () => {
    let page = 1;
    const delayed = Promise.withResolvers<void>();
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn().mockReturnValueOnce(delayed.promise).mockRejectedValueOnce(new Error('private')),
      snapshot: vi.fn(),
    };
    const sent: LocalAudioFrame[] = [];
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => page,
      nextSequence: () => sent.length + 1,
      send: (frame) => {
        sent.push(frame);
      },
      openSettings: () => Promise.resolve({ state: 'accepted' }),
    });
    const base = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, connectionEpoch: 'a', sequence: 1 };
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 1, requestId: 1 });
    await vi.waitFor(() => {
      expect(client.refresh).toHaveBeenCalledTimes(1);
    });
    page = 2;
    delayed.resolve();
    await Promise.resolve();
    expect(sent).toEqual([]);
    bridge.accept({ ...base, type: 'facepalmRefresh', pageEpoch: 2, requestId: 2 });
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({
        type: 'facepalmControlResult',
        result: { operation: 'recheck', outcome: { state: 'failed', reason: 'inspection' } },
      });
    });
    await bridge.dispose();
  });

  it('does not start a local action superseded before its effect runs', async () => {
    let page = 1;
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn(),
    };
    const openSettings = vi
      .fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>()
      .mockResolvedValue({ state: 'accepted' });
    const bridge = new CompanionFacepalm({ client, epoch: 'a', page: () => page, nextSequence: () => 1, send: () => {}, openSettings });
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmOpenSettings',
      pageEpoch: 1,
      requestId: 1,
    });
    page = 2;
    await Promise.resolve();
    expect(openSettings).not.toHaveBeenCalled();
    await bridge.dispose();
  });
  it('reports bounded local launch stages without raw errors', async () => {
    const report = vi.fn<(message: string) => void>();
    const client = {
      markBeat: vi.fn(),
      retire: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      feel: vi.fn(),
      setEnabled: vi.fn(),
      refresh: vi.fn(),
      snapshot: vi.fn(),
    };
    const bridge = new CompanionFacepalm({
      client,
      epoch: 'a',
      page: () => 1,
      nextSequence: () => 1,
      send: () => {},
      openSettings: () => Promise.resolve({ state: 'failed', reason: 'display' }),
      diagnostic: report,
    });
    bridge.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'a',
      sequence: 1,
      type: 'facepalmOpenSettings',
      pageEpoch: 1,
      requestId: 1,
    });
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledTimes(2);
    });
    expect(report.mock.calls.map(([message]) => message)).toEqual([
      'Facepalm settings request received.',
      'Facepalm settings launch failed: display.',
    ]);
    await bridge.dispose();
  });
});
