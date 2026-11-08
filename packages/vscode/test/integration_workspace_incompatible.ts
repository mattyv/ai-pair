// The workspace handles a simulated incompatible installed companion in isolation.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';
import { expectNotification } from './integration_notification';

/** Refuses a synthetic companion without committing it or starting its preview. */
export async function run(): Promise<void> {
  const companion = vscode.extensions.getExtension('michalstrba.ai-pair-local-audio');
  const main = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(companion && main, 'the workspace and synthetic companion must be installed');
  const api = await main.activate();
  try {
    await api.ready;
    const stats: unknown = await vscode.commands.executeCommand('aiPair.localAudio.syntheticStats');
    assert.deepEqual(stats, { prepare: 1, commit: 0, preview: 0 });
    await expectNotification('AI Pair and AI Pair Local Audio could not connect. Update both extensions and reload the window.');
    assert.equal(api.speechPageReady(), false);
    assert.equal(api.speechStatus(), undefined);
    await api.previewSpeech();
    assert.deepEqual(await vscode.commands.executeCommand('aiPair.localAudio.syntheticStats'), stats);
    console.log('the workspace warned and did not commit or preview a synthetic incompatible companion');
  } finally {
    api.controller.endSession();
  }
}
