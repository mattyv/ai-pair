// Exercises shortcut commands against the real workspace Controller and panel.
import * as assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import * as vscode from 'vscode';
import { MAC_MODIFIERS, type ShortcutLabels } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Checks the command routes with a live session and after it ends. */
export async function shortcutCommandPaths(api: Api): Promise<void> {
  const { controller } = api;
  controller.endSession();
  await vscode.commands.executeCommand('aiPair.togglePause');
  await vscode.commands.executeCommand('aiPair.toggleAttention');
  await vscode.commands.executeCommand('aiPair.focusReply');
  assert.equal(controller.isActive, false);
  assert.equal(controller.isPaused, false);
  await controller.start('shortcut controls');
  try {
    await vscode.commands.executeCommand('aiPair.togglePause');
    assert.equal(controller.isPaused, true);
    await vscode.commands.executeCommand('aiPair.togglePause');
    assert.equal(controller.isPaused, false);
    await vscode.commands.executeCommand('aiPair.toggleAttention');
    for (let i = 0; i < 100 && !controller.isAttentionGranted; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    assert.equal(controller.isAttentionGranted, true, 'the hand was not granted');
    await vscode.commands.executeCommand('aiPair.toggleAttention');
    assert.equal(controller.isAttentionGranted, true, 'focusing reply released the hand');
    await vscode.commands.executeCommand('aiPair.focusReply');
    assert.equal(controller.isAttentionGranted, true, 'reply focus released the hand');
    controller.resume();
    await controller.end();
    console.log('PairShortcuts: native commands use the active Controller and preserve a granted hand');
  } finally {
    controller.endSession();
  }
}

/** How long the test waits for the watcher to see a change to keybindings.json, in milliseconds. */
const LABELS_TIMEOUT_MS = 10_000;
const LABELS_POLL_MS = 50;

/** Waits until the panel holds `expected`, failing with what it held last. */
async function labelsBecome(api: Api, expected: ShortcutLabels, what: string): Promise<void> {
  const deadline = Date.now() + LABELS_TIMEOUT_MS;
  while (!isDeepStrictEqual(api.shortcuts.labels(), expected) && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, LABELS_POLL_MS);
    });
  }
  assert.deepEqual(api.shortcuts.labels(), expected, what);
}

/**
 * Converges (specs/Shortcuts.tla): the panel's tooltips follow the programmer's keybindings.json, read as the
 * extension starts and again on each change, in the profile the test runs in.
 */
export async function shortcutLabelPaths(api: Api): Promise<void> {
  const mac = process.platform === 'darwin';
  const defaults = mac
    ? {
        pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q`,
        attention: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}W`,
        reply: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Space`,
      }
    : { pause: 'Alt+Q', attention: 'Alt+W', reply: 'Ctrl+Alt+Space' };
  await labelsBecome(api, defaults, 'the defaults, with no keybindings.json');
  const file = [
    '// Rebound, removed, and one entry VS Code skips.',
    '[',
    '  { "key": "ctrl+alt+p", "command": "aiPair.togglePause" },',
    '  { "key": "ctrl+alt+r", "command": "-aiPair.toggleAttention" },',
    '  { "command": "-aiPair.toggleAttention", "when": "editorFocus" },',
    '  { "command": "-aiPair.toggleAttention" },',
    '  { "key": "cmd+k win+r", "command": "aiPair.focusReply", "when": "aiPair.active" },',
    '  3,',
    ']',
  ].join('\n');
  await vscode.workspace.fs.writeFile(api.shortcuts.file, new TextEncoder().encode(file));
  try {
    await labelsBecome(
      api,
      mac
        ? {
            pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.option}P`,
            attention: undefined,
            reply: `${MAC_MODIFIERS.command}K ${MAC_MODIFIERS.command}R`,
          }
        : { pause: 'Ctrl+Alt+P', attention: undefined, reply: 'Super+K Super+R' },
      'the keys keybindings.json binds',
    );
  } finally {
    await vscode.workspace.fs.delete(api.shortcuts.file);
  }
  await labelsBecome(api, defaults, 'the defaults again, once keybindings.json is deleted');
  console.log('PairShortcuts: the panel names the keys keybindings.json binds, and follows its changes');
}
