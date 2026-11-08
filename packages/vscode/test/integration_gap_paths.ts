// Paths of the terminals that real use takes and no other integration case did (#176): a terminal shown by
// the setting and by the panel's button.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** How often, and how many times, to look for a run the panel shows. */
const POLL_MS = 50;
const POLLS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits for the panel to show a run of `command` in `phase`, and returns its id. */
async function runShown(api: Api, command: string, phase: string): Promise<number> {
  for (let i = 0; i < POLLS; i++) {
    const run = api.history().findLast((e) => e.type === 'run' && e.command === command && e.phase === phase);
    if (run?.type === 'run') return run.id;
    await sleep(POLL_MS);
  }
  return assert.fail(`the panel never showed ${command} ${phase}`);
}

/** Runs a command with the setting that shows terminals, then shows its terminal again from the panel. */
export async function gapPaths(api: Api): Promise<void> {
  const { controller } = api;
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await controller.start('gaps');
  await settings.update('showTerminalsAutomatically', true, global);
  await controller.step([{ run: 'sleep 2', wait: 0.5 }]);
  const id = await runShown(api, 'sleep 2', 'running');
  api.panelMessage({ type: 'showTerminal', id });
  await runShown(api, 'sleep 2', 'exited');
  await settings.update('showTerminalsAutomatically', undefined, global);
  await controller.step([]);
  controller.endSession();
  console.log('the terminals: one shown by the setting and again from the panel');
}
