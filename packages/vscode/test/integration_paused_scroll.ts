// Exercises the editor viewport after playback pauses and ends in a real VS Code window.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Checks that manual navigation stays put after pausing and ending a session. */
export async function pausedScrollPaths(api: Api, root: string): Promise<void> {
  const name = 'paused-scroll.txt';
  const filename = path.join(root, name);
  const editorSettings = vscode.workspace.getConfiguration('editor');
  const pairSettings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const oldSmooth = editorSettings.inspect('smoothScrolling')?.globalValue;
  const oldTiming = pairSettings.inspect('timing')?.globalValue;
  fs.writeFileSync(filename, Array.from({ length: 500 }, (_, index) => `line ${index + 1}\n`).join(''));
  const document = await vscode.workspace.openTextDocument(filename);
  const editor = await vscode.window.showTextDocument(document);
  const controller = api.controller;
  try {
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
    await sleep(200);
    const views = vscode.window.visibleTextEditors.filter((view) => view.document.uri.fsPath === filename);
    assert.equal(views.length, 2, 'expected two editor groups for the same file');
    await pairSettings.update('timing', { glideMs: 10_000, glideMaxMs: 10_000, afterMoveFarMs: 10_000 }, global);
    for (const smooth of [false, true]) {
      await editorSettings.update('smoothScrolling', smooth, global);
      controller.setSpeed(10);
      await controller.start(`paused scrolling ${smooth}`);
      await controller.read(name);
      editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
      await sleep(600);
      assert.equal(editor.visibleRanges[0]?.start.line, 0, 'view must start at the top');
      await controller.step([{ move: { file: name, line: 400, to: 'line_end' } }]);
      // Prove the follow navigation began before pausing.
      for (let attempt = 0; attempt < 100 && (editor.visibleRanges[0]?.start.line ?? 0) === 0; attempt++) {
        await sleep(50);
      }
      assert.ok((editor.visibleRanges[0]?.start.line ?? 0) > 0, `follow did not start (smooth=${smooth})`);
      assert.equal(api.history().findLast((event) => event.type === 'state')?.state, 'typing', 'move must still be playing');
      controller.pause();
      await sleep(600);
      for (const phase of ['paused', 'ended'] as const) {
        if (phase === 'ended') controller.endSession();
        for (const [index, view] of views.entries()) {
          const line = (phase === 'paused' ? 20 : 100) + index * 30;
          view.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
        }
        // Let native smooth scrolling settle before measuring subsequent movement.
        await sleep(800);
        const tops = views.map((view) => view.visibleRanges[0]?.start.line);
        for (const [index, top] of tops.entries()) {
          const requested = (phase === 'paused' ? 20 : 100) + index * 30;
          assert.notEqual(top, undefined, `${phase}, smooth=${smooth}: no visible range`);
          assert.ok(
            top !== undefined && Math.abs(top - requested) <= 10,
            `${phase}, smooth=${smooth}: expected near ${requested}, got ${top}`,
          );
        }
        for (let sample = 0; sample < 10; sample++) {
          await sleep(200);
          assert.deepEqual(
            views.map((view) => view.visibleRanges[0]?.start.line),
            tops,
            `${phase}, smooth=${smooth}: viewport moved`,
          );
        }
      }
      await controller.end();
      controller.resume();
      console.log(`PausedScroll: manual viewport remained stable while paused and ended (smooth=${smooth})`);
    }
  } finally {
    controller.endSession();
    controller.setSpeed(1);
    await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await editorSettings.update('smoothScrolling', oldSmooth, global);
    await pairSettings.update('timing', oldTiming, global);
    fs.rmSync(filename, { force: true });
  }
}
