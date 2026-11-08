// Invalid user settings must not make the legacy preview play or crash.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Exercises the real settings fallback and restores every changed setting. */
export async function badSpeechSettings(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const changes: Array<[string, unknown]> = [
    ['speech.voice', 42],
    ['speech.speed', 'invalid'],
    ['speech.elevenLabsVoice', 42],
    ['speech.elevenLabsSpeed', 'invalid'],
  ];
  const previous = changes.map(([key]) => settings.inspect<unknown>(key)?.globalValue);
  try {
    for (const [key, value] of changes) await settings.update(key, value, global);
    for (const [key, value] of changes) assert.deepEqual(vscode.workspace.getConfiguration('aiPair').get(key), value);
    const before = api.speechStatus()?.id ?? 0;
    await api.previewSpeech();
    const preview = api.speechStatus();
    assert.ok(preview && preview.id > before, 'the preview did not create a new observation');
    assert.equal(preview.state, 'unavailable');
    assert.equal(preview.started, false);
    console.log('malformed stored speech settings fall back without starting preview audio');
  } finally {
    for (const [index, [key]] of changes.entries()) await settings.update(key, previous[index], global);
  }
}
