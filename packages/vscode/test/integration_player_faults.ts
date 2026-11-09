// Real player and editor tests with one-shot failures at the editor port.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Exercises arbitrary rejection values at real player editor boundaries. */
export async function playerFaults(api: Api, root: string): Promise<void> {
  const { controller, editor } = api;
  const filename = path.join(root, 'integration-player-fault.txt');
  const name = path.basename(filename);
  const show = Object.getOwnPropertyDescriptor(editor, 'show');
  const save = Object.getOwnPropertyDescriptor(editor, 'save');
  const edit = Object.getOwnPropertyDescriptor(editor, 'edit');
  const realShow = editor.show.bind(editor);
  const realSave = editor.save.bind(editor);
  const realEdit = editor.edit.bind(editor);
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

    let edits = 0;
    Object.defineProperty(editor, 'edit', {
      configurable: true,
      value: async (...args: Parameters<typeof editor.edit>) => {
        edits++;
        if (edits === 2) {
          const doc = await vscode.workspace.openTextDocument(filename);
          const change = new vscode.WorkspaceEdit();
          change.insert(doc.uri, new vscode.Position(0, 0), '// mine\n');
          assert.equal(await vscode.workspace.applyEdit(change), true);
          throw new Error('injected edit rejection');
        }
        await realEdit(...args);
      },
    });
    const queued = await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type: `ab${CURSOR_MARKER}c` }]);
    assert.equal(queued.rejected, undefined, JSON.stringify(queued));
    const interrupted = await controller.step([]);
    assert.equal(edits, 2, JSON.stringify(interrupted));
    assert.equal(interrupted.batches[0]?.status, 'interrupted');
    assert.deepEqual(interrupted.batches[0]?.unplayed, [{ type: `b${CURSOR_MARKER}c` }]);
    assert.equal((await vscode.workspace.openTextDocument(filename)).getText(), '// mine\nstart!a\n');
    if (edit === undefined) Reflect.deleteProperty(editor, 'edit');
    else Object.defineProperty(editor, 'edit', edit);

    const cases: Array<{
      name: string;
      mode: 'typing' | 'lines';
      initial: Action;
      typing: Action;
      rejectAt: number;
      interrupt: boolean;
      expectedText: string;
      expectedRest: Action;
      status: 'interrupted' | 'failed';
    }> = [
      {
        name: 'selection',
        mode: 'typing',
        initial: { select: { file: name, line: 1, text: 'start' } },
        typing: { type: `x${CURSOR_MARKER}` },
        rejectAt: 1,
        interrupt: true,
        expectedText: '// mine\nstart\n',
        expectedRest: { type: `x${CURSOR_MARKER}` },
        status: 'interrupted',
      },
      {
        name: 'after marker fast',
        mode: 'typing',
        initial: { move: { file: name, line: 1, to: 'line_end' } },
        typing: { type_fast: `a${CURSOR_MARKER}bc` },
        rejectAt: 3,
        interrupt: true,
        expectedText: '// mine\nstartab\n',
        expectedRest: { type_fast: `${CURSOR_MARKER}c` },
        status: 'interrupted',
      },
      {
        name: 'grouped',
        mode: 'lines',
        initial: { move: { file: name, line: 1, to: 'line_end' } },
        typing: { type: `a${CURSOR_MARKER}b\nc` },
        rejectAt: 2,
        interrupt: true,
        expectedText: '// mine\nstartab\n\n',
        expectedRest: { type: `${CURSOR_MARKER}c` },
        status: 'interrupted',
      },
      {
        name: 'ordinary rejection',
        mode: 'typing',
        initial: { move: { file: name, line: 1, to: 'line_end' } },
        typing: { type: `x${CURSOR_MARKER}` },
        rejectAt: 1,
        interrupt: false,
        expectedText: 'start\n',
        expectedRest: { type: `x${CURSOR_MARKER}` },
        status: 'failed',
      },
    ];
    for (const test of cases) {
      controller.endSession();
      const document = await vscode.workspace.openTextDocument(filename);
      const reset = new vscode.WorkspaceEdit();
      reset.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'start\n');
      assert.equal(await vscode.workspace.applyEdit(reset), true);
      await document.save();
      controller.setCodePlayback(test.mode);
      await controller.start(`edit rejection ${test.name}`);
      await controller.read(name);
      let attempts = 0;
      Object.defineProperty(editor, 'edit', {
        configurable: true,
        value: async (...args: Parameters<typeof editor.edit>) => {
          attempts++;
          if (attempts === test.rejectAt) {
            if (test.interrupt) {
              const change = new vscode.WorkspaceEdit();
              change.insert(document.uri, new vscode.Position(0, 0), '// mine\n');
              assert.equal(await vscode.workspace.applyEdit(change), true);
            }
            throw new Error('injected edit rejection');
          }
          await realEdit(...args);
        },
      });
      const submitted = await controller.step([test.initial, test.typing]);
      assert.equal(submitted.rejected, undefined, `${test.name}: ${JSON.stringify(submitted)}`);
      const result = await controller.step([]);
      assert.equal(attempts, test.rejectAt, test.name);
      assert.equal(result.batches[0]?.status, test.status, `${test.name}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.batches[0]?.unplayed, [test.expectedRest], test.name);
      if (!test.interrupt) assert.equal(result.batches[0]?.error?.message, 'injected edit rejection');
      assert.equal(document.getText(), test.expectedText, test.name);
      if (edit === undefined) Reflect.deleteProperty(editor, 'edit');
      else Object.defineProperty(editor, 'edit', edit);
    }
  } finally {
    if (edit === undefined) Reflect.deleteProperty(editor, 'edit');
    else Object.defineProperty(editor, 'edit', edit);
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
