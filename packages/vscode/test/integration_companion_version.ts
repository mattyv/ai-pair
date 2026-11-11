// The real installed companion rejects a legacy protocol request and warns the user.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { expectNotification } from './integration_notification';

/** Checks the real companion's incompatible-version warning and refusal. */
export async function run(): Promise<void> {
  const companion = vscode.extensions.getExtension('mattyv.ai-pair-local-audio');
  assert.ok(companion, 'the real companion must be installed');
  await companion.activate();
  const answer: unknown = await vscode.commands.executeCommand('aiPair.localAudio.prepare', {
    version: LOCAL_AUDIO_VERSION - 1,
    epoch: 'legacy',
  });
  assert.equal(answer, undefined, 'the companion accepted an incompatible request');
  await expectNotification('AI Pair and AI Pair Local Audio have incompatible versions. Update both extensions and reload the window.');
  assert.equal(
    await vscode.commands.executeCommand('aiPair.localAudio.diagnostics'),
    undefined,
    'an incompatible request created a companion session',
  );
  console.log('the real companion refused an old protocol request and displayed the exact warning');
}
