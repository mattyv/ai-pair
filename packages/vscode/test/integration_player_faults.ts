// Real player and editor tests with one-shot failures at the editor port.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Exercises arbitrary rejection values at real player editor boundaries. */
export async function playerFaults(api: Api, root: string): Promise<void> {
  const { controller, editor } = api;
  const filename = path.join(root, 'integration-player-fault.txt');
  const name = path.basename(filename);
  const show = Object.getOwnPropertyDescriptor(editor, 'show');
  const save = Object.getOwnPropertyDescriptor(editor, 'save');
  const realShow = editor.show.bind(editor);
  const realSave = editor.save.bind(editor);
  fs.writeFileSync(filename, 'start\n');
  controller.setSpeed(20);
  controller.setCodePlayback('typing');
  try {
    await controller.start('editor rejection values');
    await controller.read(name);
    let showFailed = false;
    Object.defineProperty(editor, 'show', {
      configurable: true,
      value: (file: string) => {
        if (!showFailed && file === filename) {
          showFailed = true;
          // Exercise a legal JavaScript rejection that is not an Error.
          // oxlint-disable-next-line eslint/prefer-promise-reject-errors
          return Promise.reject('injected show rejection');
        }
        return realShow(file);
      },
    });
    await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }]);
    const failed = await controller.step([]);
    assert.ok(showFailed, 'the show boundary was not reached');
    assert.equal(failed.batches[0]?.error?.kind, 'invalid_action');
    assert.equal(failed.batches[0]?.error?.message, 'injected show rejection');
    assert.equal((await vscode.workspace.openTextDocument(filename)).getText(), 'start\n');
    if (show === undefined) Reflect.deleteProperty(editor, 'show');
    else Object.defineProperty(editor, 'show', show);

    await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }]);
    const recovered = await controller.step([]);
    assert.equal(recovered.batches[0]?.status, 'completed');
    let saveFailed = false;
    Object.defineProperty(editor, 'save', {
      configurable: true,
      value: (file: string) => {
        if (!saveFailed && file === filename) {
          saveFailed = true;
          // Exercise the same boundary when saving an edited buffer.
          // oxlint-disable-next-line eslint/prefer-promise-reject-errors
          return Promise.reject('injected save rejection');
        }
        return realSave(file);
      },
    });
    await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `!${CURSOR_MARKER}` }]);
    const unsaved = await controller.step([]);
    assert.ok(saveFailed, 'the save boundary was not reached');
    assert.equal((await vscode.workspace.openTextDocument(filename)).getText(), 'start!\n');
    assert.equal(fs.readFileSync(filename, 'utf8'), 'start\n');
    assert.deepEqual(unsaved.batches[0]?.unsaved?.[0], { file: name, error: 'injected save rejection' });
    if (save === undefined) Reflect.deleteProperty(editor, 'save');
    else Object.defineProperty(editor, 'save', save);
    await realSave(filename);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'start!\n');
  } finally {
    if (show === undefined) Reflect.deleteProperty(editor, 'show');
    else Object.defineProperty(editor, 'show', show);
    if (save === undefined) Reflect.deleteProperty(editor, 'save');
    else Object.defineProperty(editor, 'save', save);
    controller.endSession();
    const document = await vscode.workspace.openTextDocument(filename);
    if (document.isDirty) await document.save();
    fs.rmSync(filename, { force: true });
  }
}
