// Exercises diagnostics and approval sound settings through the real extension.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Reads the user-facing diagnostics using the registered command. */
async function diagnostics(): Promise<unknown> {
  await vscode.commands.executeCommand('aiPair.copyDiagnostics');
  const value: unknown = JSON.parse(await vscode.env.clipboard.readText());
  assert.ok(value !== null && typeof value === 'object');
  return value;
}

/** Checks suspended-session diagnostics and the muted approval preference. */
export async function diagnosticCoveragePaths(api: Api): Promise<void> {
  const clipboard = await vscode.env.clipboard.readText();
  const settings = vscode.workspace.getConfiguration('aiPair');
  const keys = [
    'speech.enabled',
    'speech.provider',
    'speech.openRouterModel',
    'speech.openRouterVoice',
    'speech.openRouterZdr',
    'commandApprovalSound',
  ];
  const saved = keys.map((key) => settings.inspect<unknown>(key)?.globalValue);
  const target = vscode.ConfigurationTarget.Global;
  try {
    await settings.update('speech.enabled', false, target);
    await settings.update('speech.provider', 'kokoro', target);
    await settings.update('speech.openRouterModel', 42, target);
    await settings.update('speech.openRouterVoice', 42, target);
    await settings.update('speech.openRouterZdr', false, target);
    const idle = await diagnostics();
    assert.ok(idle !== null && typeof idle === 'object' && 'audio' in idle);
    assert.ok(idle.audio !== null && typeof idle.audio === 'object' && 'provider' in idle.audio);
    assert.equal(idle.audio.provider, 'kokoro');

    await api.controller.start('diagnostics while disconnected');
    api.controller.disconnect();
    assert.equal(api.controller.isSuspended, true);
    const suspended = await diagnostics();
    assert.ok(suspended !== null && typeof suspended === 'object' && 'session' in suspended);
    assert.equal(suspended.session, 'suspended');
    api.controller.endSession();
    const ended = await diagnostics();
    assert.ok(ended !== null && typeof ended === 'object' && 'session' in ended);
    assert.equal(ended.session, 'ended');

    await settings.update('commandApprovalSound', true, target);
    api.panelMessage({ type: 'commandApprovalSound', value: false });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (vscode.workspace.getConfiguration('aiPair').get('commandApprovalSound') === false) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('commandApprovalSound'), false);
  } finally {
    api.controller.endSession();
    api.controller.disconnect();
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key !== undefined) await settings.update(key, saved[index], target);
    }
    await vscode.env.clipboard.writeText(clipboard);
  }
}
