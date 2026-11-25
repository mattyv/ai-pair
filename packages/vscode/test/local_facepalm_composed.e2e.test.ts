import { describe, expect, it, vi } from 'vitest';
import { LOCAL_AUDIO_VERSION, type FacepalmCue } from '@ai-pair/protocol';
import { LocalConnection } from '../../audio-ui/src/local_connection';
import { CompanionFacepalm } from '../../audio-ui/src/companion_facepalm';
import { WorkspaceSession } from '../src/workspace_session';

describe('local Facepalm attachment', () => {
  it('Success: moves a beat and feedback through the selected channel and retires on page close', async () => {
    const cue: FacepalmCue = { id: 9, feeling: 'agreement', feelings: ['agreement'] };
    const client = {
      markBeat: vi.fn().mockResolvedValue(cue),
      feel: vi.fn().mockResolvedValue(undefined),
      retire: vi.fn(),
      snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
      dispose: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    let localSequence = 0;
    let workspace: WorkspaceSession;
    const openSettings = vi
      .fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>()
      .mockResolvedValue({ state: 'accepted' });
    const companion = new CompanionFacepalm({
      client,
      epoch: 'connection',
      page: () => 1,
      nextSequence: () => ++localSequence,
      send: (frame) => {
        workspace.accept(frame);
      },
      openSettings,
    });
    const connection = new LocalConnection({
      leaseMs: 60_000,
      lost: () => {
        void companion.dispose();
      },
      receive: (frame) => {
        companion.accept(frame);
      },
    });
    connection.attach({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'connection', sequence: 1, type: 'attach' });
    workspace = new WorkspaceSession({
      epoch: 'connection',
      panel: { attachRemote: () => {}, receiveRemote: () => {}, closeRemote: () => {} },
      send: (frame) => (connection.accept(frame) ? Promise.resolve() : Promise.reject(new Error('rejected'))),
      lost: () => {},
    });
    workspace.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'connection',
      sequence: ++localSequence,
      type: 'panelAction',
      pageEpoch: 1,
      action: { type: 'ready' },
    });
    workspace.facepalm.onStatus = () => {
      throw new Error('observer');
    };
    expect(
      workspace.accept({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: 'connection',
        sequence: ++localSequence,
        type: 'facepalmStatus',
        pageEpoch: 1,
        snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true },
      }),
    ).toBe(true);
    expect(await workspace.facepalm.markBeat('question', 1500)).toEqual(cue);
    await workspace.facepalm.feel(9, 'agreement');
    await vi.waitFor(() => {
      expect(client.feel).toHaveBeenCalledWith(9, 'agreement');
    });
    workspace.facepalm.retire();
    expect(await workspace.facepalm.openSettings()).toEqual({ state: 'accepted' });
    expect(openSettings).toHaveBeenCalledOnce();
    workspace.facepalm.onSettingsFailure = () => {
      throw new Error('observer');
    };
    expect(
      workspace.accept({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: 'connection',
        sequence: ++localSequence,
        type: 'facepalmSettingsNotice',
        pageEpoch: 1,
        requestId: 1,
        failure: { state: 'failed', reason: 'qt' },
      }),
    ).toBe(true);
    expect(await workspace.facepalm.markBeat('question', 1)).toEqual(cue);
    workspace.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'connection',
      sequence: ++localSequence,
      type: 'panelAction',
      pageEpoch: 1,
      action: { type: 'pageClosed' },
    });
    await vi.waitFor(() => {
      expect(client.retire).toHaveBeenCalled();
    });
    workspace.dispose();
    connection.dispose();
  });
});
