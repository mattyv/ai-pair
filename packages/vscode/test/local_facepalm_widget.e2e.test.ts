import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Controller } from '@ai-pair/core';
import { CommandChannel, LOCAL_AUDIO_VERSION, localPanelAction, type LocalAudioFrame } from '@ai-pair/protocol';
import type * as vscode from 'vscode';
import { NarrationPanel, type PanelWiring } from '../src/panel';
import type { Calibration } from '../src/calibration';
import { WorkspaceSession } from '../src/workspace_session';
import { LocalConnection } from '../../audio-ui/src/local_connection';
import { CompanionFacepalm } from '../../audio-ui/src/companion_facepalm';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn().mockResolvedValue(undefined) } }));

it('routes the rendered settings button to the local companion after session retirement', async () => {
  const window = new Window();
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLDetailsElement',
    'HTMLAnchorElement',
    'HTMLAudioElement',
    'HTMLDialogElement',
    'HTMLLabelElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
  ]) {
    if (key === 'window') vi.stubGlobal(key, window);
    else if (key === 'document') vi.stubGlobal(key, window.document);
    else vi.stubGlobal(key, Reflect.get(window, key));
  }
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    },
  );
  let localSequence = 0;
  let workspace: WorkspaceSession;
  const openSettings = vi.fn<() => Promise<import('@ai-pair/protocol').FacepalmSettingsLaunch>>().mockResolvedValue({ state: 'accepted' });
  const client = {
    markBeat: vi.fn().mockResolvedValue(undefined),
    feel: vi.fn().mockResolvedValue(undefined),
    retire: vi.fn(),
    snapshot: vi.fn().mockReturnValue({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
    dispose: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const companion = new CompanionFacepalm({
    client,
    epoch: 'attachment',
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
  connection.attach({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'attachment', sequence: 1, type: 'attach' });
  const controller = mock<Controller>({ commandApprovals: { all: false, commands: [], confirmationRequired: true } });
  const wiring = mock<PanelWiring>({
    calibration: () => mock<Calibration>(),
    workerEnabled: { get: () => false, set: () => {} },
    workerModel: { get: () => '', set: () => {} },
    workerVisibility: { get: () => 'milestones', set: () => {} },
    controller: () => controller,
    starter: { available: () => Promise.resolve(false), start: () => Promise.resolve() },
    facepalm: {
      snapshot: () => ({ enabled: true, status: 'idle', available: true, canOpenSettings: true }),
      enabled: () => {},
      refresh: () => {
        void workspace.facepalm.refresh();
      },
      openSettings: () => {
        void workspace.facepalm.openSettings();
      },
    },
  });
  const numberSetting = { get: () => 1, set: () => {} };
  const flag = { get: () => false, set: () => {} };
  const panel = new NarrationPanel(
    () => '',
    numberSetting,
    numberSetting,
    { current: () => undefined, ref: () => undefined },
    () => {},
    mock<vscode.Uri>(),
    wiring,
    { get: () => 'newestFirst', set: () => {} },
    { version: 'test', build: 'test' },
    flag,
    () => false,
    { get: () => 'typing', set: () => {} },
    { get: () => 'interrupt', set: () => {} },
    flag,
    { get: () => 'helpful', set: () => {} },
  );
  workspace = new WorkspaceSession({
    epoch: 'attachment',
    panel,
    send: (frame) => (connection.accept(frame) ? Promise.resolve() : Promise.reject(new Error('refused'))),
    lost: () => {},
  });
  const channel = new CommandChannel<LocalAudioFrame>({
    timeoutMs: 1000,
    maxPending: 128,
    lost: () => {},
    send: (frame) => (workspace.accept(frame) ? Promise.resolve() : Promise.reject(new Error('refused'))),
  });
  try {
    const { loadPage } = await import('./page');
    await loadPage((message) => {
      const parsed = localPanelAction.safeParse(message);
      if (!parsed.success) return;
      void channel.send({
        version: LOCAL_AUDIO_VERSION,
        connectionEpoch: 'attachment',
        sequence: ++localSequence,
        type: 'panelAction',
        pageEpoch: 1,
        action: parsed.data,
      });
    });
    await vi.waitFor(() => {
      expect(workspace.pageReady()).toBe(true);
    });
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { type: 'facepalmStatus', enabled: true, status: 'approvalNeeded', available: true, canOpenSettings: true },
      }),
    );
    const recheck = window.document.querySelector('[data-ui="facepalm-recheck"]');
    expect(recheck).not.toBeNull();
    recheck?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(client.refresh).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(workspace.facepalm.snapshot().status).toBe('idle');
    });
    expect(client.markBeat).not.toHaveBeenCalled();
    workspace.facepalm.retire();
    const button = window.document.querySelector('[data-ui="facepalm-open-settings"]');
    expect(button).not.toBeNull();
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(openSettings).toHaveBeenCalledOnce();
    });
  } finally {
    channel.dispose();
    workspace.dispose();
    connection.dispose();
    vi.unstubAllGlobals();
    await window.happyDOM.abort();
  }
});
