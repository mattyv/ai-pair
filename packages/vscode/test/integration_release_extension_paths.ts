// Exercises settings changes through the real legacy extension host with speech disabled.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Waits until the real configuration service publishes a setting. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

/** Changes compute preferences without launching a speech worker or GPU check. */
export async function exerciseReleaseExtensionPaths(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const target = vscode.ConfigurationTarget.Global;
  const enabled = settings.inspect<unknown>('speech.enabled')?.globalValue;
  const mode = settings.inspect<unknown>('speech.computeMode')?.globalValue;
  try {
    await settings.update('speech.enabled', false, target);
    // External Settings changes reconcile with the lifecycle owner before a panel change.
    await settings.update('speech.computeMode', 'auto', target);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.computeMode'), 'auto');
    await settings.update('speech.computeMode', 'gpu', target);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.computeMode'), 'gpu');
    api.panelMessage({ type: 'speechComputeMode', value: 'cpu' });
    await until(() => vscode.workspace.getConfiguration('aiPair').get('speech.computeMode') === 'cpu', 'the panel compute choice');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.enabled'), false);
  } finally {
    await settings.update('speech.computeMode', mode, target);
    await settings.update('speech.enabled', enabled, target);
  }
}
