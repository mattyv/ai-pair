import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Api } from '../src/extension';
import { speechOutcome, waitForGestureWindow } from './speech_smoke_integration';

vi.mock('vscode', () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('does not mistake speaking followed by cancellation for completed playback', () => {
  const api = mock<Api>();
  api.speechStatus.mockReturnValue({ id: 2, state: 'idle', started: true });
  expect(() => {
    speechOutcome(api, 1, 'PREVIEW', 100);
  }).toThrow('did not end');
  api.speechStatus.mockReturnValue({ id: 2, state: 'idle', started: true, terminal: 'ended' });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  speechOutcome(api, 1, 'PREVIEW', 100);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('audio_outcome=started_and_ended'));
});

it('reports only an accepted page failure, not a generic transport failure', () => {
  const api = mock<Api>();
  api.speechStatus.mockReturnValue({ id: 3, state: 'unavailable', started: false, message: 'Audio could not play.' });
  expect(() => {
    speechOutcome(api, 2, 'PREVIEW', 100);
  }).toThrow('did not end');
  api.speechStatus.mockReturnValue({ id: 3, state: 'unavailable', started: false, terminal: 'failed', message: 'Audio could not play.' });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  speechOutcome(api, 2, 'PREVIEW', 100);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('audio_outcome=playback_failed'));
});

it('opens a bounded gesture window only when explicitly requested', async () => {
  vi.useFakeTimers();
  vi.stubEnv('AI_PAIR_SPEECH_UI_GESTURE', '1');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  let finished = false;
  const waiting = waitForGestureWindow().then(() => {
    finished = true;
  });
  expect(log).toHaveBeenCalledWith('NATIVE_SPEECH_WAITING_FOR_UI_GESTURE');
  await vi.advanceTimersByTimeAsync(14_999);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(finished).toBe(true);
});

it('does not delay the ordinary native smoke', async () => {
  vi.stubEnv('AI_PAIR_SPEECH_UI_GESTURE', '0');
  await waitForGestureWindow();
});
