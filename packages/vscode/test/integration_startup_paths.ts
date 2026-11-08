// Exercises early public operations in a fresh legacy-owner window before awaiting its readiness.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Queues safe early requests, then checks their results once placement and the bridge settle. */
export async function exerciseStartup(api: Api): Promise<void> {
  // The fresh profile contains no speech model or credential; the runner points audio at nonexistent servers.
  const preview = api.previewSpeech();
  const removeKey = vscode.commands.executeCommand('aiPair.removeElevenLabsKey');
  api.panelMessage({ type: 'speechOutputRefresh' });
  await Promise.all([api.ready, preview, removeKey]);
  const observation = api.speechStatus();
  assert.ok(observation, 'early preview produced no legacy observation');
  assert.equal(observation.state, 'unavailable');
  assert.equal(observation.started, false);
  console.log('early preview and key removal settle after extension readiness');
}
