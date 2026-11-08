// Runs in a second isolated VS Code profile with the real local companion installed before activation.
// It downloads no model, makes no cloud request, and uses an unreachable audio server.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { localSpeechReport } from '@ai-pair/protocol';
import type { Api } from '../src/extension';
import { prepareRecovery, verifyRecovery } from './integration_recovery_restart';

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

  if (process.env.AI_PAIR_COMPANION_RESTART === 'verify') {
    assert.equal(api.saved()?.task, 'companion integration', 'the workspace did not restore its saved session');
    assert.equal(api.controller.isSuspended, true, 'the restored session was not suspended');
    assert.ok(
      api.history().some((event) => event.type === 'programmer' && event.text === 'retained companion reply'),
      'the workspace did not restore the visible session history',
    );
    await verifyRecovery(api);
    await api.controller.end();
    console.log('the restarted companion restored the suspended session and its visible history');
    return;
  }

  await api.controller.start('companion integration');
  if (process.env.AI_PAIR_COMPANION_RESTART === 'prepare') await prepareRecovery(api);
  api.panelMessage({ type: 'reply', text: 'retained companion reply', attach: false });
  await until(() => api.history().some((event) => event.type === 'programmer' && event.text === 'retained companion reply'), 'the reply');
  assert.ok(api.history().length > 0, 'the workspace retained no session history');
  await vscode.commands.executeCommand('aiPair.focusReply');

  // The isolated companion profile has no model, and the runner directs audio to nonexistent servers.
  // Exercise the normal preview command and verify it fails closed without starting playback.
  const previous: unknown = await vscode.commands.executeCommand('aiPair.localAudio.status');
  await api.previewSpeech();
  const preview: unknown = await vscode.commands.executeCommand('aiPair.localAudio.status');
  assert.ok(preview !== null && typeof preview === 'object' && 'id' in preview && typeof preview.id === 'number');
  assert.ok('started' in preview && preview.started === false && 'state' in preview && preview.state === 'unavailable');
  if (previous !== null && typeof previous === 'object' && 'id' in previous && typeof previous.id === 'number') {
    assert.ok(preview.id > previous.id, 'the preview did not create a new observation');
  }

  // Exercise the real native key prompt, then cancel without entering or storing a credential.
  const keyPrompt = vscode.commands.executeCommand('aiPair.setElevenLabsKey');
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 500);
  });
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await Promise.race([
    keyPrompt,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('The key prompt did not close'));
      }, 5000);
    }),
  ]);
  const beforeRemoval = localSpeechReport.parse(await vscode.commands.executeCommand('aiPair.localAudio.diagnostics'));
  const previousSequence = Math.max(0, ...beforeRemoval.events.map((event) => event.seq));
  await vscode.commands.executeCommand('aiPair.removeElevenLabsKey');
  let confirmed = false;
  for (let attempt = 0; attempt < 100 && !confirmed; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    const local = localSpeechReport.parse(await vscode.commands.executeCommand('aiPair.localAudio.diagnostics'));
    confirmed = local.events.some((event) => event.seq > previousSequence && event.provider === 'elevenlabs' && event.reason === 'no_key');
  }
  assert.ok(confirmed, 'the companion did not confirm the absent key');

  // Change and restore the global provider settings without loading voices or making a cloud request.
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  try {
    await settings.update('speech.enabled', true, global);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.enabled'), true);
    await settings.update('speech.provider', 'elevenlabs', global);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.provider'), 'elevenlabs');
    await settings.update('speech.provider', 'kokoro', global);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.provider'), 'kokoro');
    await settings.update('speech.enabled', false, global);
  } finally {
    await settings.update('speech.provider', undefined, global);
    await settings.update('speech.enabled', undefined, global);
  }
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
  if (process.env.AI_PAIR_COMPANION_RESTART === 'prepare') {
    await until(() => api.saved()?.task === 'companion integration', 'the persisted session');
    // History is written alongside the session; allow the workspace storage write to finish before Code exits.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1000);
    });
  } else {
    await api.controller.end();
  }
  console.log('the installed companion owns the panel, forwards updates, and supplies local diagnostics');
}
