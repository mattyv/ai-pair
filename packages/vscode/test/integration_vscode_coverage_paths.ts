// Exercises the panel's approval reset through the real extension host.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Waits for an observable editor or controller state. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  assert.fail(`Timed out waiting for ${description}`);
}

/** Revokes a session grant and restores confirmation through the panel. */
export async function vscodeCoveragePaths(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const target = vscode.ConfigurationTarget.Global;
  const original = settings.inspect<unknown>('confirmCommands')?.globalValue;
  const { controller } = api;
  const terminals = new Set(vscode.window.terminals);
  try {
    await settings.update('confirmCommands', false, target);
    api.panelMessage({ type: 'revokeCommandApprovals' });
    await until(
      () => vscode.workspace.getConfiguration('aiPair').get('confirmCommands') === true,
      'confirmation to be restored without a session',
    );
    await settings.update('confirmCommands', true, target);
    await controller.start('reset command approvals');
    const firstHistory = new Set(api.history());
    await controller.step([{ run: 'echo approval-reset' }]);
    await until(
      () =>
        api
          .history()
          .filter((event) => !firstHistory.has(event))
          .some((event) => event.type === 'run' && event.command === 'echo approval-reset' && event.phase === 'confirm'),
      'the command approval prompt',
    );
    const prompt = api
      .history()
      .filter((event) => !firstHistory.has(event))
      .find((event) => event.type === 'run' && event.command === 'echo approval-reset' && event.phase === 'confirm');
    assert.ok(prompt && prompt.type === 'run');
    api.panelMessage({ type: 'runDecision', id: prompt.id, run: true, scope: 'all' });
    await controller.step([]);
    assert.equal(controller.commandApprovals.all, true);

    api.panelMessage({ type: 'revokeCommandApprovals' });
    await until(() => !controller.commandApprovals.all, 'the approval grant to be revoked');
    await until(() => vscode.workspace.getConfiguration('aiPair').get('confirmCommands') === true, 'confirmation to be persisted');
    assert.equal(controller.commandApprovals.confirmationRequired, true);
    const secondHistory = new Set(api.history());
    await controller.step([{ run: 'echo after-reset' }]);
    await until(
      () =>
        api
          .history()
          .filter((event) => !secondHistory.has(event))
          .some((event) => event.type === 'run' && event.command === 'echo after-reset' && event.phase === 'confirm'),
      'confirmation after revocation',
    );
    const after = api
      .history()
      .filter((event) => !secondHistory.has(event))
      .find((event) => event.type === 'run' && event.command === 'echo after-reset' && event.phase === 'confirm');
    assert.ok(after && after.type === 'run');
    api.panelMessage({ type: 'runDecision', id: after.id, run: false, scope: 'once' });
    assert.equal((await controller.step([])).batches[0]?.error?.kind, 'command_declined');
  } finally {
    controller.endSession();
    for (const terminal of vscode.window.terminals) if (!terminals.has(terminal)) terminal.dispose();
    await until(() => vscode.window.terminals.every((terminal) => terminals.has(terminal)), 'test terminals to close');
    await settings.update('confirmCommands', original, target);
  }

  // A malformed settings file must not turn invalid cloud selections into readiness.
  const changes: Array<[string, unknown]> = [
    ['speech.enabled', false],
    ['speech.provider', 'openrouter'],
    ['speech.openRouterModel', 42],
    ['speech.openRouterVoice', 42],
    ['speech.openRouterZdr', 'invalid'],
    ['speech.openRouterFormat', 'invalid'],
  ];
  const previous = changes.map(([key]) => settings.inspect<unknown>(key)?.globalValue);
  const clipboard = await vscode.env.clipboard.readText();
  try {
    for (const [key, value] of changes) await settings.update(key, value, target);
    // A malformed model remains unready with valid privacy and output preferences.
    await settings.update('speech.openRouterZdr', true, target);
    await settings.update('speech.openRouterFormat', 'pcm', target);
    await vscode.commands.executeCommand('aiPair.copyDiagnostics');
    const report: unknown = JSON.parse(await vscode.env.clipboard.readText());
    assert.ok(report !== null && typeof report === 'object' && 'audio' in report);
    assert.ok(report.audio !== null && typeof report.audio === 'object' && 'voiceConfigured' in report.audio);
    assert.equal(report.audio.voiceConfigured, false);
    await settings.update('speech.openRouterZdr', 'invalid', target);
    await settings.update('speech.openRouterFormat', 'invalid', target);
    await api.previewSpeech();
    assert.equal(api.speechStatus()?.state, 'unavailable');
    assert.equal(api.speechStatus()?.started, false);
  } finally {
    for (let index = changes.length - 1; index >= 0; index--) {
      const change = changes[index];
      if (change !== undefined) await settings.update(change[0], previous[index], target);
    }
    await vscode.env.clipboard.writeText(clipboard);
  }

  const value = {
    enabled: false,
    voice: 'af_heart',
    speed: 1,
    provider: 'openrouter',
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: '',
    openRouterVoice: '',
    openRouterZdr: false,
    openRouterFormat: 'mp3',
  };
  const originalProvider = settings.inspect<unknown>('speech.provider')?.globalValue;
  const persistedKeys = [
    'speech.enabled',
    'speech.listeningSpeed',
    'speech.voice',
    'speech.speed',
    'speech.provider',
    'speech.elevenLabsVoice',
    'speech.elevenLabsSpeed',
    'speech.openRouterModel',
    'speech.openRouterVoice',
    'speech.openRouterZdr',
    'speech.openRouterFormat',
  ];
  const saved = persistedKeys.map((key) => settings.inspect<unknown>(key)?.globalValue);
  try {
    await settings.update('speech.enabled', false, target);
    await settings.update('speech.provider', 'kokoro', target);
    for (const invalid of [
      { ...value, openRouterZdr: 'yes' },
      { ...value, openRouterFormat: 'wav' },
      { ...value, openRouterModel: 42 },
      { ...value, openRouterVoice: 42 },
      { ...value, openRouterModel: 'unknown/model', openRouterVoice: 'unknown-voice' },
    ]) {
      api.panelMessage({ type: 'speechSettings', value: invalid });
      await vscode.commands.executeCommand('aiPair.copyDiagnostics');
      const report: unknown = JSON.parse(await vscode.env.clipboard.readText());
      assert.ok(report !== null && typeof report === 'object' && 'audio' in report);
      assert.ok(report.audio !== null && typeof report.audio === 'object' && 'provider' in report.audio);
      assert.equal(report.audio.provider, 'kokoro');
    }
    // A previously saved voice remains editable when the catalog is unavailable.
    await settings.update('speech.openRouterModel', 'saved/model', target);
    await settings.update('speech.openRouterVoice', 'saved-voice', target);
    await settings.update('speech.openRouterFormat', 'mp3', target);
    api.panelMessage({
      type: 'speechSettings',
      value: { ...value, openRouterModel: 'saved/model', openRouterVoice: 'saved-voice', openRouterFormat: 'pcm' },
    });
    await until(() => vscode.workspace.getConfiguration('aiPair').get('speech.openRouterFormat') === 'pcm', 'the saved voice settings');
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.provider'), 'openrouter');
  } finally {
    for (let index = persistedKeys.length - 1; index >= 0; index--) {
      const key = persistedKeys[index];
      if (key !== undefined) await settings.update(key, saved[index], target);
    }
    assert.equal(vscode.workspace.getConfiguration('aiPair').inspect<unknown>('speech.provider')?.globalValue, originalProvider);
    await vscode.env.clipboard.writeText(clipboard);
  }
}
