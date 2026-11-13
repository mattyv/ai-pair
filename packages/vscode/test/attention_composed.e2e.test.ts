import { CURSOR_MARKER } from '@ai-pair/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { setup, advance, until } from '../../core/test/fake';
import { NarrationPanel, type PanelWiring } from '../src/panel';

vi.mock('vscode', () => ({ window: { showErrorMessage: vi.fn() } }));
afterEach(() => {
  vi.useRealTimers();
});

it('delivers a draft reply at the granted floor before releasing queued editing', async () => {
  vi.useFakeTimers();
  const { controller, editor, panel: events } = setup({ 'a.ts': '' });
  await controller.start();
  const wiring = mock<PanelWiring>();
  wiring.controller.mockReturnValue(controller);
  wiring.calibration.mockReturnValue(mock());
  wiring.speech = mock();
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
  panel.attachRemote(1, () => {});
  await controller.step([{ say: 'Reading.' }, { move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }]);
  panel.receiveRemote(1, { type: 'attention' });
  await advance(2000);
  expect(events.events).toContainEqual({ type: 'attention', state: 'granted' });
  panel.receiveRemote(1, { type: 'draft', empty: false });
  panel.receiveRemote(1, { type: 'reply', text: 'Wait.', defer: true });
  await until(controller.step([]));
  expect(editor.text('a.ts')).toBe('');
  expect(controller.isPaused).toBe(false);
});
