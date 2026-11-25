// A panel setting reads back its choice until saved, and warns when it cannot be saved (#119).
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** How long a poll for a setting's outcome waits, in 50 ms steps: 5 seconds. */
const POLLS = 100;

/** Waits until `condition` holds, or fails with `description`. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < POLLS && !condition(); attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  assert.ok(condition(), description);
}

/** Returns AI Pair's settings as VS Code holds them now. */
function settings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiPair');
}

/**
 * Drives specs/SettingRoundTrip.tla through the real panel and VS Code's settings: a change is saved, and with every
 * save made to fail, each panel setting warns (NoSilentFailure) and reads its stored value again (SettledTruth).
 */
export async function settingRoundTripPaths(api: Api): Promise<void> {
  const global = vscode.ConfigurationTarget.Global;
  api.panelMessage({ type: 'chatOrder', value: 'oldestFirst' });
  await until(() => settings().get('chatOrder') === 'oldestFirst', 'the chat order was not saved');
  await settings().update('chatOrder', undefined, global);

  const workerBefore = {
    enabled: settings().get('worker.enabled'),
    codex: settings().get('worker.codexModel'),
    claude: settings().get('worker.claudeModel'),
    visibility: settings().get('worker.visibility'),
  };
  const configDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
  const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
  assert.ok(configDescriptor && errorDescriptor, 'VS Code settings APIs are unavailable');
  const getConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
  const errors: string[] = [];
  try {
    // Every save fails, as one across a lost remote link would; reads still see the real settings.
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      ...configDescriptor,
      value: (...args: Parameters<typeof vscode.workspace.getConfiguration>) => {
        const real = getConfiguration(...args);
        return new Proxy(real, {
          get: (target, property) =>
            property === 'update'
              ? () => Promise.reject(new Error('injected settings failure'))
              : (Reflect.get(target, property) as unknown),
        });
      },
    });
    Object.defineProperty(vscode.window, 'showErrorMessage', {
      ...errorDescriptor,
      value: (...args: unknown[]) => {
        if (typeof args[0] === 'string') errors.push(args[0]);
        return Promise.resolve(undefined);
      },
    });
    const changes: Array<[unknown, string]> = [
      [{ type: 'speed', value: 2 }, 'speed'],
      [{ type: 'readingSpeed', value: 2 }, 'reading speed'],
      [{ type: 'codePlayback', value: 'lines' }, 'code display'],
      [{ type: 'replyBehavior', value: 'finishAction' }, 'reply behavior'],
      [{ type: 'navigatorCommentary', value: 'quiet' }, 'navigator commentary'],
      [{ type: 'chatOrder', value: 'oldestFirst' }, 'chat order'],
      [{ type: 'showTerminals', value: true }, 'show terminals'],
      [{ type: 'commandApprovalSound', value: true }, 'command approval sound'],
      [{ type: 'workerEnabled', value: workerBefore.enabled !== true }, 'worker enabled'],
      [{ type: 'workerModel', provider: 'codex', value: 'integration-rollback' }, 'Codex worker model'],
      [{ type: 'workerModel', provider: 'claude', value: 'integration-rollback' }, 'Claude worker model'],
      [{ type: 'workerVisibility', value: workerBefore.visibility === 'everything' ? 'off' : 'everything' }, 'worker visibility'],
    ];
    for (const [message, label] of changes) {
      api.panelMessage(message);
      const expected = `Could not save the ${label} setting.`;
      await until(() => errors.includes(expected), `no warning for the ${label} setting`);
    }
    assert.equal(settings().get('chatOrder'), 'newestFirst', 'a failed save changed the chat order');
    assert.equal(settings().get('worker.enabled'), workerBefore.enabled, 'a failed save changed worker admission');
    assert.equal(settings().get('worker.codexModel'), workerBefore.codex, 'a failed save changed the Codex model');
    assert.equal(settings().get('worker.claudeModel'), workerBefore.claude, 'a failed save changed the Claude model');
    assert.equal(settings().get('worker.visibility'), workerBefore.visibility, 'a failed save changed worker visibility');
  } finally {
    Object.defineProperty(vscode.workspace, 'getConfiguration', configDescriptor);
    Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
  }
  console.log('panel settings save, and warn and keep their stored value when a save fails');
}
