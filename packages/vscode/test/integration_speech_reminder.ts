// Checks companion readiness through the real extension-host command boundary.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Does not remind when enabled local speech has no installed model. */
export async function unavailableSpeechReminder(api: Api): Promise<void> {
  assert.equal(await vscode.commands.executeCommand('aiPair.localAudio.ready', 'stale-epoch'), false);
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  try {
    await settings.update('speech.provider', 'kokoro', global);
    await settings.update('speech.enabled', true, global);
    for (let index = 0; index < 3; index++) {
      const accepted = await api.controller.step([{ say: 'Read silently.', speak: false }]);
      const report = await api.controller.step([]);
      assert.equal(accepted.speechReminder, undefined, 'an unavailable companion must not prompt for speech');
      assert.equal(report.speechReminder, undefined, 'an unavailable companion must not prompt for speech');
    }
  } finally {
    await settings.update('speech.provider', undefined, global);
    await settings.update('speech.enabled', undefined, global);
  }
}
