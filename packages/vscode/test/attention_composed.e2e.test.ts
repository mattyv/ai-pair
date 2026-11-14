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

it.each([
  { message: undefined, expected: true },
  { message: 'Change direction', expected: false },
])('preserves queued navigator work on plain handback and cancels it for a message: $expected', async ({ message, expected }) => {
  vi.useFakeTimers();
  const { controller, editor, panel: events } = setup({ 'a.ts': 'observed line' });
  const trace: string[] = [];
  controller.trace = (line) => {
    trace.push(line);
  };
  const wiring = mock<PanelWiring>();
  wiring.controller.mockReturnValue(controller);
  wiring.calibration.mockReturnValue(mock());
  wiring.speech = mock();
  const numberSetting = { get: () => 1, set: () => {} };
  const booleanSetting = { get: () => false, set: () => {} };
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
    { get: () => 'helpful', set: () => {} },
  );
  try {
    await controller.start();
    await controller.read('a.ts');
    controller.takeTurn();
    await until(controller.listen());
    await controller.step([{ say: 'First observation.' }]);
    controller.pause();
    const submitted = controller.step([{ say: 'A useful observation.' }, { point: { file: 'a.ts', line: 1, text: 'observed line' } }]);
    for (let attempt = 0; attempt < 100 && !trace.some((line) => line.startsWith('batch 2 queued:')); attempt++) {
      await Promise.resolve();
    }
    expect(trace).toContain('batch 2 queued: 2 actions');
    if (message === undefined) editor.userEdit('a.ts', { offset: 13, deleteLength: 0, text: ' suffix' });
    panel.receiveFromPage({ type: 'turn', ...(message === undefined ? {} : { message }) });
    let driver: Promise<unknown> | undefined;
    if (message === undefined) {
      expect(controller.isPaused).toBe(true);
      driver = controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `!${CURSOR_MARKER}` }]);
      panel.receiveFromPage({ type: 'resume' });
    }
    await until(submitted);
    if (driver !== undefined) await until(driver);
    await until(controller.step([]));
    expect(events.events.some((event) => event.type === 'say' && event.text === 'A useful observation.')).toBe(expected);
    expect(events.events.some((event) => event.type === 'point')).toBe(expected);
    if (message === undefined) expect(editor.text('a.ts')).toBe('observed line suffix!');
  } finally {
    controller.endSession();
  }
});
