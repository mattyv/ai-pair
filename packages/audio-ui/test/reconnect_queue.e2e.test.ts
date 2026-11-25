import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION, localAudioPrepared } from '@ai-pair/protocol';
import { activate, deactivate } from '../src/extension';
import { createCompanionSession } from '../src/companion_session';

/**
 * The companion extension and its real attachment gate together, through the commands the workspace calls, for the
 * race the #127 review found: a reconnect attempt the workspace gives up on while the old session still retires.
 */
const fake = vi.hoisted(() => ({
  commands: new Map<string, (value: unknown) => unknown>(),
  retirements: [] as Array<Promise<void>>,
  disposed: [] as string[],
}));
vi.mock('vscode', () => ({
  window: { showWarningMessage: vi.fn(), registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })) },
  commands: {
    registerCommand: (name: string, callback: (value: unknown) => unknown) => {
      fake.commands.set(name, callback);
      return { dispose: vi.fn() };
    },
  },
}));
vi.mock('../src/companion_session', () => ({
  createCompanionSession: vi.fn((...args: [unknown, string]) => ({
    dispose: () => {
      fake.disposed.push(args[1]);
      return fake.retirements.shift() ?? Promise.resolve();
    },
  })),
}));
vi.mock('../../vscode/src/panel', () => ({ NarrationPanel: { viewId: 'aiPair.narration' } }));

afterEach(async () => {
  await deactivate();
  fake.commands.clear();
  fake.retirements.length = 0;
  fake.disposed.length = 0;
  vi.mocked(createCompanionSession).mockClear();
});

/** Calls one of the companion's commands, as the workspace does across hosts. */
function call(name: string, value: unknown): unknown {
  const command = fake.commands.get(name);
  if (command === undefined) throw new Error(`No ${name} command`);
  return command(value);
}

/** Prepares `epoch` with the companion and returns its answer, parsed. */
function prepare(epoch: string): import('@ai-pair/protocol').LocalAudioPrepared {
  return localAudioPrepared.parse(call('aiPair.localAudio.prepare', { version: LOCAL_AUDIO_VERSION, epoch }));
}

it('SingleSession, ConnectedIsLive: an attempt given up during a slow retirement neither starts nor is acknowledged (#127 review)', async () => {
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  expect(await call('aiPair.localAudio.commit', prepare('first'))).toBe(true);
  const retirement = Promise.withResolvers<void>();
  fake.retirements.push(retirement.promise);
  // The second attempt retires the first session, which is slow; the workspace gives up on it and tries a third.
  const second = call('aiPair.localAudio.commit', prepare('second'));
  const third = call('aiPair.localAudio.commit', prepare('third'));
  retirement.resolve();
  expect(await third).toBe(true);
  expect(await second).toBe(false);
  expect(vi.mocked(createCompanionSession).mock.calls.map((args) => args[1])).toEqual(['first', 'third']);
  await deactivate();
  // Every session that started is disposed: none is left running.
  expect(fake.disposed).toEqual(['first', 'third']);
});
