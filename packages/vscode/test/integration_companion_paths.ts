// Runs in a second isolated VS Code profile with the real local companion installed before activation.
// It deliberately does not configure a provider or request audio.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

/** Exercises the real companion attachment and panel in its own extension host. */
export async function run(): Promise<void> {
  const companion = vscode.extensions.getExtension('michalstrba.ai-pair-local-audio');
  assert.ok(companion, 'the local companion must be installed before main activation');
  const main = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(main, 'main extension not found');
  const api = await main.activate();
  await api.ready;

  const report: unknown = await vscode.commands.executeCommand('aiPair.localAudio.diagnostics');
  assert.ok(report !== null && typeof report === 'object', 'companion attachment did not complete');
  assert.equal(api.speechStatus(), undefined, 'the legacy speech service must not own this panel');
  await vscode.commands.executeCommand('aiPair.narration.focus');
  await until(() => api.speechPageReady(), 'the companion webview ready handshake');

  await api.controller.start('companion integration');
  assert.ok(api.history().length > 0, 'the workspace retained no session history');
  await vscode.commands.executeCommand('aiPair.focusReply');
  await vscode.commands.executeCommand('aiPair.removeElevenLabsKey');
  await vscode.env.clipboard.writeText('');
  api.panelMessage({ type: 'copyDiagnostics' });
  let copied = '';
  for (let attempt = 0; attempt < 100 && copied === ''; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    copied = await vscode.env.clipboard.readText();
  }
  assert.ok(copied.includes('localSpeech'), 'copied diagnostics omitted the local companion');
  api.controller.pause('reply');
  await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
  await until(() => !api.controller.isPaused && api.speechPageReady(), 'the reloaded companion webview');
  await api.controller.end();
  console.log('the installed companion owns the panel, forwards updates, and supplies local diagnostics');
}
