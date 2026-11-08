// Real companion command failures injected only at VS Code's command transport.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { localSpeechReport } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Exercises the main extension's handling of failed companion commands. */
export async function companionFaults(api: Api): Promise<void> {
  const executeDescriptor = Object.getOwnPropertyDescriptor(vscode.commands, 'executeCommand');
  const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
  const warningDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showWarningMessage');
  assert.ok(executeDescriptor && errorDescriptor && warningDescriptor, 'VS Code command APIs are unavailable');
  const execute = vscode.commands.executeCommand.bind(vscode.commands);
  const showError = vscode.window.showErrorMessage.bind(vscode.window);
  const showWarning = vscode.window.showWarningMessage.bind(vscode.window);
  let lostWarnings = 0;
  let target = '';
  let failures = 0;
  const errors: string[] = [];
  try {
    Object.defineProperty(vscode.commands, 'executeCommand', {
      ...executeDescriptor,
      value: (command: string, ...args: unknown[]) => {
        if (command === target && command === 'aiPair.localAudio.frame') {
          target = '';
          failures++;
          return Promise.resolve(false);
        }
        if (command === target) {
          target = '';
          failures++;
          return Promise.reject(new Error('injected companion transport failure'));
        }
        return execute(command, ...args);
      },
    });
    Object.defineProperty(vscode.window, 'showErrorMessage', {
      ...errorDescriptor,
      value: (...args: unknown[]) => {
        if (typeof args[0] === 'string') errors.push(args[0]);
        const result: unknown = Reflect.apply(showError, undefined, args);
        return result;
      },
    });
    Object.defineProperty(vscode.window, 'showWarningMessage', {
      ...warningDescriptor,
      value: (...args: unknown[]) => {
        if (args[0] === 'AI Pair lost its local audio connection. Reload the window to reconnect.') lostWarnings++;
        const result: unknown = Reflect.apply(showWarning, undefined, args);
        return result;
      },
    });
    target = 'aiPair.localAudio.keySet';
    await execute('aiPair.setElevenLabsKey');
    assert.equal(failures, 1);
    assert.ok(errors.includes('Could not save the ElevenLabs API key.'));
    target = 'aiPair.localAudio.keyRemove';
    await execute('aiPair.removeElevenLabsKey');
    assert.equal(failures, 2);
    assert.ok(errors.includes('Could not remove the ElevenLabs API key.'));

    // A transport error must still leave the workspace diagnostics copy usable.
    await vscode.env.clipboard.writeText('');
    target = 'aiPair.localAudio.diagnostics';
    api.panelMessage({ type: 'copyDiagnostics' });
    let copied = '';
    for (let attempt = 0; attempt < 100 && copied === ''; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
      copied = await vscode.env.clipboard.readText();
    }
    const unavailable = JSON.parse(copied) as unknown;
    assert.ok(unavailable !== null && typeof unavailable === 'object' && 'localSpeech' in unavailable);
    assert.equal(unavailable.localSpeech, 'unavailable');
    assert.ok(
      'events' in unavailable &&
        Array.isArray(unavailable.events) &&
        unavailable.events.some(
          (event: unknown) => event !== null && typeof event === 'object' && 'kind' in event && event.kind === 'session',
        ),
      'workspace session diagnostics are absent',
    );
    assert.equal(failures, 3);

    target = 'aiPair.localAudio.preview';
    await assert.rejects(api.previewSpeech(), /injected companion transport failure/);
    assert.equal(failures, 4);
    const before = localSpeechReport.parse(await execute('aiPair.localAudio.diagnostics'));
    const sequence = Math.max(0, ...before.events.map((event) => event.seq));
    await execute('aiPair.removeElevenLabsKey');
    let removed = false;
    for (let attempt = 0; attempt < 100 && !removed; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      const report = localSpeechReport.parse(await execute('aiPair.localAudio.diagnostics'));
      removed = report.events.some((event) => event.seq > sequence && event.provider === 'elevenlabs' && event.reason === 'no_key');
    }
    assert.ok(removed, 'the real companion did not recover to an absent key');
    const previous: unknown = await execute('aiPair.localAudio.status');
    const previousId =
      previous !== null && typeof previous === 'object' && 'id' in previous && typeof previous.id === 'number' ? previous.id : 0;
    await api.previewSpeech();
    const status: unknown = await execute('aiPair.localAudio.status');
    assert.ok(status !== null && typeof status === 'object' && 'state' in status && status.state === 'unavailable');
    assert.ok('started' in status && status.started === false, 'preview unexpectedly started audio');
    assert.ok('id' in status && typeof status.id === 'number' && status.id > previousId, 'preview did not create a new observation');
    // A refused real frame retires the connection; retain the workspace history.
    await execute('aiPair.narration.focus');
    for (let attempt = 0; attempt < 100 && !api.speechPageReady(); attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    assert.ok(api.speechPageReady(), 'the companion page did not become ready');
    target = 'aiPair.localAudio.frame';
    api.panelMessage({ type: 'reply', text: 'retained after frame refusal', attach: false });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (lostWarnings > 0) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    assert.equal(failures, 5, 'the real frame boundary was not reached');
    assert.equal(lostWarnings, 1, 'the lost connection warning was not shown');
    assert.ok(api.history().some((event) => event.type === 'programmer' && event.text === 'retained after frame refusal'));
  } finally {
    Object.defineProperty(vscode.commands, 'executeCommand', executeDescriptor);
    Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
    Object.defineProperty(vscode.window, 'showWarningMessage', warningDescriptor);
  }
}

/** Runs transport faults in the main extension's isolated test host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(extension);
  const api = await extension.activate();
  await api.ready;
  await api.controller.start('companion transport fault');
  try {
    await companionFaults(api);
  } finally {
    api.controller.endSession();
  }
}
