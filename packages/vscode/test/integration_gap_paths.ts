// Paths of the terminals that real use takes and no other integration case did (#176): a terminal shown by
// the setting and by the panel's button.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** How often, and how many times, to look for a run the panel shows. */
const POLL_MS = 50;
const POLLS = 200;

/** How long a report may take after an interrupt. */
const INTERRUPT_WAIT_MS = 5000;

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

/** Waits for the panel to show a run of `command` that has ended, whatever way it ended. */
async function runEnded(api: Api, command: string): Promise<void> {
  for (let i = 0; i < POLLS; i++) {
    const run = api.history().findLast((e) => e.type === 'run' && e.command === command);
    if (run?.type === 'run' && run.phase !== 'running' && run.phase !== 'confirm') return;
    await sleep(POLL_MS);
  }
  assert.fail(`the panel never showed ${command} ended`);
}

/** Disposes every terminal there is, so the next command opens a new one, and waits for the extension to forget them. */
async function closeTerminals(): Promise<void> {
  for (const terminal of vscode.window.terminals) {
    terminal.dispose();
  }
  for (let i = 0; i < POLLS && vscode.window.terminals.length > 0; i++) {
    await sleep(POLL_MS);
  }
}

/** Interrupts a command while an intentionally slow shell is starting. */
async function interruptedTerminalStart(api: Api): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const shell = path.join(folder.uri.fsPath, 'integration-slow-shell.sh');
  const marker = path.join(folder.uri.fsPath, 'integration-command-started');
  fs.writeFileSync(shell, '#!/bin/sh\nsleep 5\nexec /bin/bash "$@"\n', { mode: 0o700 });
  const platform = process.platform === 'darwin' ? 'osx' : 'linux';
  const terminalSettings = vscode.workspace.getConfiguration('terminal.integrated');
  const profilesKey = `profiles.${platform}`;
  const defaultKey = `defaultProfile.${platform}`;
  const previousProfiles = terminalSettings.inspect<Record<string, unknown>>(profilesKey)?.globalValue;
  const previousDefault = terminalSettings.inspect<string>(defaultKey)?.globalValue;
  const global = vscode.ConfigurationTarget.Global;
  const { controller } = api;
  try {
    await terminalSettings.update(profilesKey, { ...previousProfiles, 'AI Pair slow integration shell': { path: shell } }, global);
    await terminalSettings.update(defaultKey, 'AI Pair slow integration shell', global);
    controller.setConfirmCommands(false);
    controller.setSpeed(20);
    await closeTerminals();
    await controller.start('interrupted terminal start');
    const command = `touch "${marker}"`;
    await controller.step([{ run: command, wait: 10 }]);
    await runShown(api, command, 'running');
    let settled = false;
    const pending = controller.step([]);
    void pending.finally(() => {
      settled = true;
    });
    for (let i = 0; i < POLLS && vscode.window.terminals.length === 0; i++) await sleep(1);
    const terminal = vscode.window.terminals.at(-1);
    assert.ok(terminal, 'the command never created a terminal');
    assert.equal(terminal.shellIntegration, undefined, 'the shell was ready before the interruption');
    assert.equal(settled, false, 'the command already completed before the interruption');
    controller.userInterrupt();
    const report = await Promise.race([pending, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(report, 'the command did not stop waiting after interruption');
    assert.ok(
      report.events.some((event) => event.kind === 'interrupt'),
      'the interruption was not reported',
    );
    await runShown(api, command, 'declined');
    assert.equal(fs.existsSync(marker), false, 'the command started despite interruption during shell setup');
    console.log('an interrupt while a slow shell starts stops the command before execution');
  } finally {
    controller.endSession();
    await closeTerminals();
    await terminalSettings.update(defaultKey, previousDefault, global);
    await terminalSettings.update(profilesKey, previousProfiles, global);
  }
}

/** Diagnostic observers cannot disrupt an actual session when they throw. */
async function diagnosticObserverFailure(api: Api): Promise<void> {
  const { controller } = api;
  const original = controller.onDiagnostic;
  let seen = 0;
  controller.onDiagnostic = () => {
    seen++;
    throw new Error('test diagnostic observer');
  };
  try {
    const report = await controller.start('diagnostic observer failure');
    assert.equal(report.turn, 'agent');
    controller.pause();
    assert.equal(controller.isPaused, true);
    controller.resume();
    assert.equal(controller.isPaused, false);
    controller.endSession();
    assert.ok(seen >= 3, 'the throwing observer was not exercised');
  } finally {
    controller.onDiagnostic = original;
    controller.endSession();
  }
  console.log('a throwing diagnostic observer does not change the session');
}

/** Interrupts normal typing after it passes the marker, preserving its exact unplayed suffix. */
async function interruptedTypingAfterMarker(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const filename = path.join(folder.uri.fsPath, 'integration-interrupt-after-marker.txt');
  fs.writeFileSync(filename, '\n');
  const document = await vscode.workspace.openTextDocument(filename);
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const controller = api.controller;
  const suffix = 'cdefghijklmnopqrstuvwxyz';
  await settings.update(
    'timing',
    {
      type: { charMs: 90, jitter: 0, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
      beforeMoveMs: 0,
      afterMoveNearMs: 0,
      afterMoveFarMs: 0,
    },
    global,
  );
  controller.setSpeed(1);
  controller.setCodePlayback('typing');
  try {
    await controller.start('interrupt typing after marker');
    await controller.read('integration-interrupt-after-marker.txt');
    await controller.step([
      { move: { file: 'integration-interrupt-after-marker.txt', line: 1, to: 'line_end' } },
      { type: `ab${CURSOR_MARKER}${suffix}` },
    ]);
    const pending = controller.step([]);
    for (let i = 0; i < POLLS && document.lineAt(0).text.length < 5; i++) await sleep(POLL_MS);
    const typed = document.lineAt(0).text;
    assert.ok(typed.startsWith('abcde') && typed.length < 2 + suffix.length, `typing did not stop within the suffix: ${typed}`);
    controller.userInterrupt();
    const report = await pending;
    const interrupted = report.batches.find((batch) => batch.status === 'interrupted');
    assert.ok(interrupted, 'the typing batch was not interrupted');
    const rest = interrupted.unplayed?.[0];
    assert.ok(rest && 'type' in rest, 'the unplayed typing suffix was not reported');
    const finalText = document.lineAt(0).text;
    assert.equal(rest.type, CURSOR_MARKER + suffix.slice(finalText.length - 2));
    assert.equal(finalText + rest.type.replace(CURSOR_MARKER, ''), `ab${suffix}`);
    console.log('TypeAfter: interruption after the cursor marker reports the exact remaining suffix');
  } finally {
    controller.endSession();
    controller.setSpeed(20);
    await settings.update('timing', undefined, global);
  }
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
  await runEnded(api, 'sleep 2');
  await settings.update('showTerminalsAutomatically', undefined, global);
  await controller.step([]);
  controller.endSession();
  console.log('the terminals: one shown by the setting and again from the panel');
  await interruptedTerminalStart(api);
  await diagnosticObserverFailure(api);
  await interruptedTypingAfterMarker(api);
}
