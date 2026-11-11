// Focused native VS Code smoke for the installed local speech service. The
// caller supplies an isolated profile whose normal global storage already has
// the verified model; this test never chooses or overrides a cache path.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Maximum time to wait for the Pair page to become ready. */
const PAGE_TIMEOUT_MS = 15_000;
/** Maximum time for one preview or selected narration to finish. */
const SPEECH_TIMEOUT_MS = 45_000;
/** Bounded time for a trusted UI gesture during the diagnostic run. */
const GESTURE_WAIT_MS = 15_000;
/** How often the page readiness is checked. */
const POLL_MS = 100;
/** The selected unit sent through the same core API as an agent. */
const SELECTED_TEXT = 'This short explanation is selected for local narration.';

/** Checks that the activated extension has the integration API used here. */
function isApi(value: unknown): value is Api {
  return (
    typeof value === 'object' &&
    value !== null &&
    'controller' in value &&
    'ready' in value &&
    'history' in value &&
    'previewSpeech' in value &&
    typeof value.previewSpeech === 'function' &&
    'speechPageReady' in value &&
    typeof value.speechPageReady === 'function' &&
    'speechStatus' in value &&
    typeof value.speechStatus === 'function'
  );
}

/** Waits at most the given time for an operation. */
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    reject(new Error(`${label} timed out after ${ms} ms`));
  }, ms);
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits for the live Pair webview to complete its page handshake. */
async function waitForPage(api: Api): Promise<void> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (!api.speechPageReady() && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
  assert.ok(api.speechPageReady(), 'Pair speech page did not become ready');
}

/** Reports observed playback or an explicit page playback rejection. */
export function speechOutcome(api: Api, previousId: number, label: string, elapsedMs: number): void {
  const observation = api.speechStatus();
  assert.ok(observation !== undefined && observation.id > previousId, `${label} did not produce a new speech status`);
  if (observation.started && observation.terminal === 'ended' && observation.state === 'idle') {
    console.log(`NATIVE_SPEECH_${label}_COMPLETE elapsed_ms=${elapsedMs} audio_outcome=started_and_ended`);
    return;
  }
  if (observation.state === 'unavailable' && observation.terminal === 'failed') {
    console.log(`NATIVE_SPEECH_${label}_COMPLETE elapsed_ms=${elapsedMs} audio_outcome=playback_failed`);
    return;
  }
  assert.fail(`${label} did not end playback or report an accepted page failure: ${JSON.stringify(observation)}`);
}

/** Allows a trusted UI gesture only in the explicitly requested diagnostic run. */
export function waitForGestureWindow(): Promise<void> {
  if (process.env.AI_PAIR_SPEECH_UI_GESTURE !== '1') return Promise.resolve();
  console.log('NATIVE_SPEECH_WAITING_FOR_UI_GESTURE');
  return new Promise((resolve) => {
    setTimeout(resolve, GESTURE_WAIT_MS);
  });
}

/** Runs preview and selected live narration in an isolated VS Code profile. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('mattyv.ai-pair');
  assert.ok(extension, 'AI Pair extension not found');
  const exported: unknown = await extension.activate();
  assert.ok(isApi(exported), 'AI Pair did not export the speech integration API');
  const api = exported;
  await bounded(api.ready, PAGE_TIMEOUT_MS, 'Extension readiness');
  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'No isolated workspace');
  const settings = vscode.workspace.getConfiguration('aiPair');
  const originalEnabled = settings.inspect<unknown>('speech.enabled')?.globalValue;
  try {
    await api.controller.start('Local narration smoke', workspace.uri.fsPath);
    await vscode.commands.executeCommand('aiPair.narration.focus');
    await waitForPage(api);
    await waitForGestureWindow();

    const beforePreview = api.speechStatus()?.id ?? 0;
    const previewStart = Date.now();
    await bounded(api.previewSpeech(), SPEECH_TIMEOUT_MS, 'Speech preview');
    speechOutcome(api, beforePreview, 'PREVIEW', Date.now() - previewStart);

    await settings.update('speech.enabled', true, vscode.ConfigurationTarget.Global);
    const historyStart = api.history().length;
    const beforeSpeech = api.speechStatus()?.id ?? 0;
    const speechStart = Date.now();
    const submitted = await bounded(api.controller.step([{ say: SELECTED_TEXT, speak: true }]), SPEECH_TIMEOUT_MS, 'Speech submission');
    assert.equal(submitted.rejected, undefined, 'Selected narration was rejected');
    const finished = await bounded(api.controller.step([]), SPEECH_TIMEOUT_MS, 'Selected narration');
    assert.deepEqual(
      finished.batches.map((batch) => batch.status),
      ['completed'],
    );
    assert.ok(
      api
        .history()
        .slice(historyStart)
        .some((event) => event.type === 'say' && event.text === SELECTED_TEXT),
      'The selected narration text was not displayed in the Pair history',
    );
    speechOutcome(api, beforeSpeech, 'SELECTED', Date.now() - speechStart);
  } finally {
    api.controller.endSession();
    await settings.update('speech.enabled', originalEnabled, vscode.ConfigurationTarget.Global);
  }
}
