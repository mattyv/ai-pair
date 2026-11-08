// Runs the final-save deferred-reply path inside a real VS Code extension host.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Sends a deferred reply during the player's final, real editor save. */
export async function deferredSettlementPaths(api: Api, root: string): Promise<void> {
  const file = path.join(root, 'deferred-settlement.txt');
  await fs.writeFile(file, '');
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  await api.controller.start('deferred save');
  api.controller.setSpeed(20);
  const previousTrace = api.controller.trace;
  const traces: string[] = [];
  api.controller.trace = (line) => {
    traces.push(line);
    previousTrace?.(line);
  };
  let sent = false;
  const participant = vscode.workspace.onWillSaveTextDocument((event) => {
    if (event.document.uri.fsPath !== file || sent) return;
    sent = true;
    // The player's action has ended; its final save has not returned yet.
    api.panelMessage({ type: 'reply', text: 'After the action', defer: true });
  });
  try {
    const first = await api.controller.step([
      { move: { file: 'deferred-settlement.txt', line: 1, to: 'line_end' } },
      { type: `done${CURSOR_MARKER}` },
    ]);
    const second = await api.controller.step([]);
    assert.equal(sent, true, 'the final save participant did not run');
    assert.equal(document.getText(), 'done');
    assert.equal(traces.filter((line) => line.startsWith('interrupt:')).length, 1);
    assert.deepEqual([...first.events, ...second.events], [{ kind: 'message', text: 'After the action' }]);
    assert.deepEqual(
      [...first.batches, ...second.batches].map((batch) => batch.status),
      ['completed'],
    );
    await api.controller.end();
    console.log('DeferredSettlement: reply during final save is delivered once');
  } finally {
    participant.dispose();
    api.controller.trace = previousTrace;
    await fs.rm(file, { force: true });
  }
}
