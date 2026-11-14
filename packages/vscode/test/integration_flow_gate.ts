// Exercises speech sequencing through a real controller, player, and VS Code editor.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import type { Controller } from '@ai-pair/core';
import type { Api } from '../src/extension';

/** Waits for observable editor or narration progress with a deadline. */
async function until(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** Bounds a controller operation and clears its deadline on settlement. */
async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, 12_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Verifies overlap, serialization, and cancellation through the loaded editor bundle. */
export async function flowGatePaths(api: Api, root: string): Promise<void> {
  const file = path.join(root, 'flow-gate.txt');
  fs.writeFileSync(file, '');
  const crlfFile = path.join(root, 'flow-gate-crlf.txt');
  fs.writeFileSync(crlfFile, 'head\r\n');
  const document = await vscode.workspace.openTextDocument(file);
  const crlfDocument = await vscode.workspace.openTextDocument(crlfFile);
  await vscode.window.showTextDocument(document);
  const calls: string[] = [];
  let finish: (() => void) | undefined;
  let canceled = 0;
  const LoadedController = z.custom<typeof Controller>((value) => typeof value === 'function').parse(api.controller.constructor);
  const controller = new LoadedController(api.editor, { post: () => {} }, undefined, {
    speak: (text) => {
      calls.push(text);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    attentionCue: () => Promise.resolve(),
    pause: () => {},
    resume: () => {},
    cancel: () => {
      canceled++;
      finish?.();
    },
  });
  controller.setSpeed(20);
  controller.setReadingSpeed(20);
  try {
    await within(controller.start('speech overlap editor gate'), 'session did not start');
    await within(controller.read('flow-gate.txt'), 'file was not read');
    await within(
      controller.step([
        { say: 'First narration.', speak: true, speech_mode: 'continue' },
        { move: { file: 'flow-gate.txt', line: 1, to: 'line_end' } },
        { type: `typed${CURSOR_MARKER}` },
        { say: 'Second narration.', speak: true },
      ]),
      'batch was not accepted',
    );
    await until(() => document.getText() === 'typed', 'typing did not progress while narration was pending');
    assert.deepEqual(calls, ['First narration.']);
    finish?.();
    await until(() => calls.length === 2, 'second narration did not follow the first');
    let completed = false;
    const report = controller.step([]).then((value) => {
      completed = true;
      return value;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    assert.equal(completed, false, 'default wait finished before narration');
    finish?.();
    assert.equal((await within(report, 'batch did not finish after narration')).batches[0]?.status, 'completed');
    await within(controller.end(), 'session did not end');

    await within(controller.start('bracket move with selection'), 'selection session did not start');
    await within(controller.read('flow-gate.txt'), 'selection file was not read');
    await within(controller.step([{ select: { file: 'flow-gate.txt', line: 1, text: 'typed' } }]), 'selection was not accepted');
    assert.equal((await within(controller.step([]), 'selection did not finish')).batches[0]?.status, 'completed');
    const selected = await within(controller.step([{ move: { to: 'next_close' } }]), 'selected bracket move did not settle');
    assert.equal(selected.rejected?.error.kind, 'invalid_action');
    assert.match(selected.rejected?.error.message ?? '', /requires one closing bracket immediately after an unselected cursor/);
    await within(controller.end(), 'selection session did not end');

    await within(controller.start('grouped typing after marker'), 'grouped typing session did not start');
    await within(controller.read('flow-gate-crlf.txt'), 'grouped typing file was not read');
    controller.setCodePlayback('lines');
    await within(
      controller.step([
        { move: { file: 'flow-gate-crlf.txt', line: 1, to: 'line_end' } },
        { type: `a${CURSOR_MARKER}\nb\nc` },
        { type_fast: `X${CURSOR_MARKER}` },
      ]),
      'grouped typing was not accepted',
    );
    assert.equal((await within(controller.step([]), 'grouped typing did not finish')).batches[0]?.status, 'completed');
    assert.equal(crlfDocument.getText(), 'headaX\r\nb\r\nc\r\n');
    controller.setCodePlayback('typing');
    await within(controller.end(), 'grouped typing session did not end');

    await within(controller.start('grouped LF typing after marker'), 'LF typing session did not start');
    await within(controller.read('flow-gate.txt'), 'LF typing file was not read');
    controller.setCodePlayback('lines');
    await within(
      controller.step([
        { move: { file: 'flow-gate.txt', line: 1, to: 'line_end' } },
        { type: `a${CURSOR_MARKER}\nb\nc` },
        { type_fast: `X${CURSOR_MARKER}` },
      ]),
      'LF typing was not accepted',
    );
    assert.equal((await within(controller.step([]), 'LF typing did not finish')).batches[0]?.status, 'completed');
    assert.equal(document.getText(), 'typedaX\nb\nc');
    controller.setCodePlayback('typing');
    await within(controller.end(), 'LF typing session did not end');

    await within(controller.start('speech cancellation editor gate'), 'second session did not start');
    await within(
      controller.step([{ say: 'Cancelable narration.', speak: true, speech_mode: 'continue' }]),
      'cancel batch was not accepted',
    );
    await until(() => calls.includes('Cancelable narration.'), 'cancelable narration did not start');
    const before = canceled;
    controller.endSession();
    await until(() => canceled > before, 'ending the session did not cancel narration');
    await within(controller.step([]), 'ended session did not settle');
    console.log('SpeechOverlap: real editor typing proceeds, later speech waits, and ending cancels');
  } finally {
    finish?.();
    controller.setCodePlayback('typing');
    controller.endSession();
    controller.disconnect();
    fs.rmSync(file, { force: true });
    fs.rmSync(crlfFile, { force: true });
  }
}
