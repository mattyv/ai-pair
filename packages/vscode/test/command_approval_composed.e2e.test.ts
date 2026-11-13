import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { setup, throughStorage, advance, until } from '../../core/test/fake';
import { NarrationPanel, type PanelWiring, type Starter } from '../src/panel';
import { WorkspacePanelBridge } from '../src/workspace_panel_bridge';
import { WorkspaceSession } from '../src/workspace_session';

vi.mock('vscode', () => ({ window: { showErrorMessage: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
});

it('Revoke: a current companion page clears grants, stale pages cannot revoke, and restored commands require confirmation', async () => {
  vi.useFakeTimers();
  const { controller, editor, panel: events } = setup();
  await controller.start();
  const wiring = mock<PanelWiring>();
  wiring.controller.mockReturnValue(controller);
  const starter = mock<Starter>();
  starter.available.mockResolvedValue(true);
  wiring.starter = starter;
  const persist = Promise.withResolvers<void>();
  wiring.requireCommandApproval.mockReturnValue(persist.promise);
  const numberSetting = { get: () => 1, set: vi.fn<(value: number) => void>() };
  const booleanSetting = { get: () => false, set: vi.fn<(value: boolean) => void>() };
  const panel = new NarrationPanel(
    (file) => file,
    numberSetting,
    numberSetting,
    { current: () => undefined, ref: () => undefined },
    () => {},
    mock(),
    wiring,
    { get: () => 'newestFirst', set: vi.fn<(value: 'newestFirst' | 'oldestFirst') => void>() },
    { version: 'test', build: 'test' },
    booleanSetting,
    () => false,
    { get: () => 'typing', set: vi.fn<(value: 'typing' | 'lines' | 'blocks') => void>() },
    { get: () => 'interrupt', set: vi.fn<(value: 'interrupt' | 'finishAction') => void>() },
    booleanSetting,
    { get: () => 'helpful', set: () => {} },
  );
  const bridge = new WorkspacePanelBridge({
    epoch: 'epoch',
    action: (action) => {
      const page = bridge.page();
      if (page === undefined) throw new Error('Missing page');
      if (action.type === 'ready') panel.attachRemote(page, () => {});
      panel.receiveRemote(page, action);
    },
    terminal: () => {},
    pageChanged: () => {},
  });
  let sequence = 0;
  function send(pageEpoch: number, action: unknown): boolean {
    return bridge.accept({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'epoch',
      sequence: ++sequence,
      type: 'panelAction',
      pageEpoch,
      action,
    });
  }
  expect(send(1, { type: 'ready' })).toBe(true);
  await controller.step([{ run: 'npm test' }]);
  await advance(100);
  const first = events.events.find((event) => event.type === 'run' && event.phase === 'confirm');
  if (first?.type !== 'run') throw new Error('Missing confirmation');
  expect(send(1, { type: 'runDecision', id: first.id, run: true, scope: 'all' })).toBe(true);
  await until(controller.step([]));
  expect(controller.commandApprovals.all).toBe(true);
  expect(send(2, { type: 'ready' })).toBe(true);
  expect(send(1, { type: 'revokeCommandApprovals' })).toBe(false);
  expect(controller.commandApprovals.all).toBe(true);
  expect(send(2, { type: 'revokeCommandApprovals' })).toBe(true);
  expect(controller.commandApprovals).toEqual({ all: false, commands: [], confirmationRequired: true });
  expect(wiring.requireCommandApproval).toHaveBeenCalledOnce();
  const saved = throughStorage(controller.saved);
  await controller.step([{ run: 'npm test' }]);
  await advance(100);
  expect(events.events.filter((event) => event.type === 'run' && event.phase === 'confirm')).toHaveLength(2);
  expect(editor.commands).toHaveLength(1);
  controller.userInterrupt();
  await until(controller.listen());
  persist.resolve();
  const restored = setup();
  restored.controller.revive(saved);
  await restored.controller.start();
  expect(restored.controller.commandApprovals).toEqual({ all: false, commands: [], confirmationRequired: true });
  await restored.controller.step([{ run: 'npm test' }]);
  await advance(100);
  expect(restored.panel.events.some((event) => event.type === 'run' && event.phase === 'confirm')).toBe(true);
  expect(restored.editor.commands).toHaveLength(0);
  restored.controller.userInterrupt();
  await until(restored.controller.listen());
  bridge.dispose();
});

it('routes commentary through the production workspace session and projects its snapshot', async () => {
  const { controller } = setup();
  const wiring = mock<PanelWiring>();
  wiring.controller.mockReturnValue(controller);
  wiring.calibration.mockReturnValue(mock());
  const starter = mock<Starter>();
  starter.available.mockResolvedValue(true);
  wiring.starter = starter;
  const numberSetting = { get: () => 1, set: () => {} };
  const booleanSetting = { get: () => false, set: () => {} };
  let preference: 'quiet' | 'helpful' | 'coach' = 'helpful';
  const panel = new NarrationPanel(
    (file) => file,
    numberSetting,
    numberSetting,
    { current: () => undefined, ref: () => undefined },
    () => {},
    mock(),
    wiring,
    { get: () => 'newestFirst', set: () => {} },
    { version: 'test', build: 'test' },
    booleanSetting,
    () => false,
    { get: () => 'typing', set: () => {} },
    { get: () => 'interrupt', set: () => {} },
    booleanSetting,
    {
      get: () => preference,
      set: (value) => {
        preference = value;
        controller.setNavigatorCommentary(value);
        panel.showNavigatorCommentary(value);
      },
    },
  );
  const frames: unknown[] = [];
  const session = new WorkspaceSession({
    epoch: 'epoch',
    panel,
    send: (frame) => {
      frames.push(frame);
      return Promise.resolve();
    },
    lost: () => {},
  });
  function send(sequence: number, action: unknown): boolean {
    return session.accept({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'epoch', sequence, type: 'panelAction', pageEpoch: 1, action });
  }
  try {
    expect(send(1, { type: 'ready' })).toBe(true);
    expect(send(2, { type: 'navigatorCommentary', value: 'coach' })).toBe(true);
    expect(preference).toBe('coach');
    expect(await controller.start()).toMatchObject({ navigatorCommentary: 'coach' });
    await vi.waitFor(() => {
      expect(frames).toContainEqual(
        expect.objectContaining({ type: 'panelChunk', data: JSON.stringify({ type: 'navigatorCommentary', value: 'coach' }) }),
      );
    });
  } finally {
    session.dispose();
  }
});
