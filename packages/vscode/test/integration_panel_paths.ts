// The panel's messages in a real VS Code, for test/integration.ts (#176). Each is handed to the panel through
// `Api.panelMessage`, which runs the webview's own handler, since the integration run opens no webview. Only
// messages whose effects are local are sent: none opens a secret input box, downloads a model, probes an audio
// device, plays a sound, or reaches the network.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** How long the panel's asynchronous handlers get to finish. */
const SETTLE_MS = 300;
/** Bounds the wait for VS Code to publish settings writes. */
const SETTING_POLLS = 100;
const SETTING_POLL_MS = 50;

/** Page ids to try: the id of the page the panel holds is not part of the Api. */
const PAGE_IDS = [0, 1, 2, 3];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits for VS Code to publish a panel setting in a fresh configuration snapshot. */
async function waitForSetting(key: string, value: unknown): Promise<void> {
  for (let attempt = 0; attempt < SETTING_POLLS; attempt++) {
    if (vscode.workspace.getConfiguration('aiPair').get(key) === value) return;
    await sleep(SETTING_POLL_MS);
  }
  assert.equal(vscode.workspace.getConfiguration('aiPair').get(key), value, `setting ${key} did not settle`);
}

/** Sends every message in `messages` to the panel, then lets its asynchronous handlers finish. */
async function sendAll(api: Api, messages: readonly unknown[]): Promise<void> {
  for (const message of messages) {
    api.panelMessage(message);
  }
  await sleep(SETTLE_MS);
}

/** Checks worker preferences through the real panel and VS Code settings. */
export async function workerPreferencePaths(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  // Worker preferences travel through the real panel and persist separately for each provider.
  // Invalid page values leave the settings unchanged.
  const workerKeys = ['worker.enabled', 'worker.codexModel', 'worker.claudeModel', 'worker.visibility'];
  const previous = workerKeys.map((key) => settings.inspect<unknown>(key)?.globalValue);
  try {
    await sendAll(api, [
      { type: 'workerEnabled', value: true },
      { type: 'workerModel', provider: 'codex', value: 'codex-test' },
      { type: 'workerModel', provider: 'claude', value: 'claude-test' },
      { type: 'workerVisibility', value: 'everything' },
    ]);
    await waitForSetting('worker.enabled', true);
    await waitForSetting('worker.codexModel', 'codex-test');
    await waitForSetting('worker.claudeModel', 'claude-test');
    await waitForSetting('worker.visibility', 'everything');
    await sendAll(api, [
      { type: 'workerEnabled', value: 'yes' },
      { type: 'workerModel', provider: 'other', value: 'invalid' },
      { type: 'workerModel', provider: 'codex', value: 17 },
      { type: 'workerModel', provider: 'codex', value: 'x'.repeat(257) },
      { type: 'workerVisibility', value: 'invalid' },
    ]);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('worker.enabled'), true);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('worker.codexModel'), 'codex-test');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('worker.visibility'), 'everything');
    await sendAll(api, [
      { type: 'workerVisibility', value: 'off' },
      { type: 'workerVisibility', value: 'milestones' },
      { type: 'workerEnabled', value: false },
      { type: 'cancelWorker' },
    ]);
    await waitForSetting('worker.enabled', false);
    await waitForSetting('worker.visibility', 'milestones');
  } finally {
    for (const [index, key] of workerKeys.entries()) {
      await settings.update(key, previous[index], global);
    }
  }
}

/** Sends trusted page-shaped messages, including invalid values that the receiving cases explicitly check. */
export async function panelPaths(api: Api): Promise<void> {
  const { controller } = api;
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;

  // A page that is ready, and the speech facts it is told, none of which touches a device.
  await sendAll(api, [{ type: 'ready' }, { type: 'ready' }]);
  // Speech events from the page: valid, then each way one is refused.
  for (const pageId of PAGE_IDS) {
    await sendAll(api, [
      { type: 'speechEvent', pageId, id: 1, event: 'started' },
      { type: 'speechEvent', pageId, id: 1, event: 'ended' },
      { type: 'speechEvent', pageId, id: 1, event: 'failed' },
      { type: 'speechEvent', pageId, id: 0, event: 'ended' },
      { type: 'speechEvent', pageId, id: 1, event: 'other' },
      { type: 'speechRetired', pageId, id: 1 },
      { type: 'speechRetired', pageId, id: 0 },
      { type: 'speechPageHidden', pageId },
      { type: 'speechPageVisible', pageId },
    ]);
  }
  await sendAll(api, [
    { type: 'speechEvent', pageId: -1, id: 1, event: 'ended' },
    { type: 'speechRetired', pageId: -1, id: 1 },
    { type: 'speechPageHidden', pageId: -1 },
    { type: 'speechPageVisible', pageId: -1 },
    { type: 'speechStop' },
    // An output choice no catalog offers is refused, and the default is kept.
    { type: 'speechOutputSelect', choice: 'nonsense' },
    { type: 'speechOutputSelect', choice: { kind: 'default' } },
  ]);

  // Voices: with the local provider selected, the page is told to select ElevenLabs (no request is made).
  await sendAll(api, [{ type: 'speechVoicesLoad' }, { type: 'speechVoicesMore' }, { type: 'speechKeyRemove' }]);

  // The speech settings: refused when any field is wrong, accepted when all are right, then the provider changed and
  // restored.
  const valid = { enabled: false, voice: 'af_heart', speed: 1, provider: 'kokoro', elevenLabsVoice: '', elevenLabsSpeed: 1 };
  await sendAll(api, [
    { type: 'speechSettings', value: { ...valid, enabled: 'yes' } },
    { type: 'speechSettings', value: { ...valid, voice: 'nobody' } },
    { type: 'speechSettings', value: { ...valid, provider: 'other' } },
    { type: 'speechSettings', value: { ...valid, elevenLabsVoice: 'not-in-the-catalog' } },
    { type: 'speechSettings', value: { ...valid, listeningSpeed: 99 } },
    { type: 'speechSettings', value: valid },
    { type: 'speechSettings', value: { ...valid, enabled: true } },
    { type: 'speechSettings', value: { ...valid, provider: 'elevenlabs' } },
    // With ElevenLabs selected and no key stored, the voice list and the preview fail on the missing key, before
    // any request is made.
    { type: 'speechVoicesLoad' },
    { type: 'speechVoicesMore' },
    { type: 'speechPreview' },
    { type: 'speechSettings', value: valid },
    // The local preview, in a profile with no speech model: it fails closed and plays nothing.
    { type: 'speechPreview' },
  ]);
  for (const key of [
    'speech.enabled',
    'speech.listeningSpeed',
    'speech.voice',
    'speech.speed',
    'speech.provider',
    'speech.elevenLabsVoice',
    'speech.elevenLabsSpeed',
  ]) {
    await settings.update(key, undefined, global);
  }

  // Diagnostics copied to the clipboard.
  await vscode.env.clipboard.writeText('');
  await sendAll(api, [{ type: 'copyDiagnostics' }]);
  assert.notEqual(await vscode.env.clipboard.readText(), '', 'the diagnostics were not copied');

  // Preferences, valid and not.
  await sendAll(api, [
    { type: 'replyBehavior', value: 'finishAction' },
    { type: 'replyBehavior', value: 'invalid' },
    { type: 'navigatorCommentary', value: 'quiet' },
    { type: 'navigatorCommentary', value: 'invalid' },
    { type: 'chatOrder', value: 'oldestFirst' },
    { type: 'chatOrder', value: 'bogus' },
    { type: 'showTerminals', value: true },
    { type: 'showTerminals', value: 'yes' },
    { type: 'showTerminal', id: 999_999 },
    { type: 'showTerminal', id: 0 },
    { type: 'speed', value: 2 },
    { type: 'speed', value: 77 },
    { type: 'readingSpeed', value: 2 },
    { type: 'readingSpeed', value: 77 },
    { type: 'codePlayback', value: 'blocks' },
    { type: 'codePlayback', value: 'bogus' },
  ]);
  for (const key of [
    'replyBehavior',
    'navigatorCommentary',
    'chatOrder',
    'showTerminalsAutomatically',
    'speed',
    'readingSpeed',
    'codePlayback',
  ]) {
    await settings.update(key, undefined, global);
  }

  await workerPreferencePaths(api);

  // Links: a command the panel may not run, a URL it may not open, and files that are not there.
  await sendAll(api, [
    { type: 'command', command: 'workbench.action.quit' },
    { type: 'openUrl', url: 'file:///etc/passwd' },
    { type: 'open', file: 'paths.txt', line: 1 },
    { type: 'openFile', file: 'paths.txt' },
    { type: 'openFile', file: 'no-such-file-anywhere.txt' },
    { type: 'openChange', file: 'paths.txt' },
    { type: 'openChange', file: 'no-such-file-anywhere.txt' },
  ]);

  // Controls with no session: nothing to act on.
  await sendAll(api, [
    { type: 'pause' },
    { type: 'resume' },
    { type: 'interrupt' },
    { type: 'draft', empty: false },
    { type: 'draft', empty: true },
    { type: 'reply', text: 'nobody listens', attach: true },
    { type: 'holdReading', id: 1, held: true },
    { type: 'holdReading', id: 1, held: 'yes' },
    { type: 'skipReading', id: 1 },
    { type: 'skipReading', id: -1 },
    { type: 'runDecision', id: 1, run: false, remember: false },
    { type: 'runDecision', id: 1, run: true, remember: true },
    { type: 'runDecision', id: 1, run: true, scope: 'command' },
    { type: 'runDecision', id: 1, run: true, scope: 'all' },
    // Forwarded to Facepalm (#83): with no approved token file here, it resolves to nothing, opening no socket.
    { type: 'facepalmFeel', id: 1, feeling: 'confused' },
    { type: 'end' },
  ]);

  // The settings preview, in a profile that has no local speech model: it fails closed, with a status for the
  // page, and plays nothing.
  await api.previewSpeech();
  await sleep(SETTLE_MS);
  assert.equal(api.speechStatus()?.state, 'unavailable');
  assert.equal(api.speechStatus()?.started, false);
  assert.equal(typeof api.speechPageReady(), 'boolean');

  // A calibration answered from the panel: go, then x stores the rate; go, then any other reply cancels it; and
  // any reply to an armed one that is not go cancels it.
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sendAll(api, [
    { type: 'reply', text: 'go' },
    { type: 'reply', text: 'x' },
  ]);
  await sleep(SETTLE_MS);
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sendAll(api, [
    { type: 'reply', text: 'go' },
    { type: 'reply', text: 'never mind' },
  ]);
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sendAll(api, [{ type: 'reply', text: 'not go' }]);
  await settings.update('timing', undefined, global);

  // Controls with a session: the programmer's reply, interrupt, pause, and turn, as the page sends them.
  await controller.start('panel messages');
  await sendAll(api, [{ type: 'pause' }]);
  assert.equal(controller.isPaused, true);
  await sendAll(api, [{ type: 'resume' }]);
  assert.equal(controller.isPaused, false);
  await sendAll(api, [{ type: 'draft', empty: false }]);
  assert.equal(controller.isPaused, true);
  await sendAll(api, [{ type: 'draft', empty: true }]);
  assert.equal(controller.isPaused, false);
  await sendAll(api, [{ type: 'reply', text: 'from the panel', attach: false }]);
  assert.ok(api.history().some((e) => e.type === 'programmer' && e.text === 'from the panel'));
  await sendAll(api, [
    { type: 'holdReading', id: 1, held: true },
    { type: 'holdReading', id: 1, held: false },
    { type: 'skipReading', id: 1 },
    { type: 'runDecision', id: 1, run: false, remember: false },
    { type: 'interrupt' },
  ]);
  assert.equal(
    (await controller.listen()).events.some((e) => e.kind === 'interrupt'),
    true,
  );
  // The turn: handed to the programmer, then back to the agent, with and without a message.
  await sendAll(api, [{ type: 'turn' }]);
  assert.equal(controller.turn, 'programmer');
  await sendAll(api, [{ type: 'turn', message: 'back to you', attach: false }]);
  assert.equal(controller.turn, 'agent');
  await sendAll(api, [{ type: 'end' }]);
  assert.equal(controller.isActive, false);
  console.log('the panel: each message its page posts, valid and not, through the webview handler');
}
