// Real VS Code integration for grouped editing and the reading controls.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Exercises actual editor writes and the controller's code-reading clock. */
export async function codePlaybackPaths(api: Api, root: string): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const controller = api.controller;
  await settings.update(
    'timing',
    {
      type: { charMs: 0, jitter: 0, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
      reading: { minMs: 600, msPerChar: 0 },
      beforeMoveMs: 0,
      afterMoveNearMs: 0,
      afterMoveFarMs: 0,
    },
    global,
  );
  controller.setSpeed(1);
  controller.setReadingSpeed(1);
  try {
    await controller.start('integration code playback');
    for (const mode of ['lines', 'blocks'] as const) {
      const name = `integration-${mode}.py`;
      const filename = path.join(root, name);
      fs.writeFileSync(filename, 'head\n');
      await controller.read(name);
      controller.setCodePlayback(mode);
      // The panel caps history, so its length is not a stable cursor.
      const before = new Set(api.history());
      const text = `  value = (1 + ${CURSOR_MARKER}2)\n  triple = """hello"""\n\n  end = 3`;
      const actions: Action[] = [{ move: { file: name, line: 1, to: 'line_end' } }, { type: `\n${text}` }];
      let done = false;
      const play = (async () => {
        await controller.step(actions);
        await controller.step([]);
      })();
      void play.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      let firstId: number | undefined;
      for (let attempt = 0; attempt < 200 && firstId === undefined; attempt++) {
        const event = api
          .history()
          .filter((item) => !before.has(item))
          .find((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined);
        if (event?.type === 'reading') firstId = event.id;
        if (firstId === undefined) await sleep(10);
      }
      assert.notEqual(firstId, undefined, `${mode}: no code reading event`);
      if (firstId === undefined) throw new Error('Missing code reading ID');
      if (mode === 'lines') {
        controller.finishReading(firstId + 1);
        controller.holdReading(firstId + 1, true);
        controller.holdReading(firstId, true);
        const document = await vscode.workspace.openTextDocument(filename);
        const heldText = document.getText();
        const completedText = `head\n  value = (1 + 2)\n  triple = """hello"""\n\n  end = 3\n`;
        assert.notEqual(heldText, completedText, 'the edit must be incomplete when the hold starts');
        assert.equal(done, false, 'playback must still be unsettled when the hold starts');
        await sleep(800);
        assert.equal(document.getText(), heldText, 'a held reading must not advance to the next code group');
        assert.equal(done, false, 'playback must remain unsettled during the hold');
        controller.pause();
        controller.holdReading(firstId, false);
        await sleep(800);
        assert.equal(document.getText(), heldText, 'releasing a hold must not release the separate pause');
        assert.equal(done, false, 'playback must remain unsettled while globally paused');
        controller.resume();
        controller.holdReading(firstId, true);
        controller.releaseReadingHold();
      }
      for (let attempt = 0; attempt < 500; attempt++) {
        if (done) break;
        const event = api
          .history()
          .filter((item) => !before.has(item))
          .findLast((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined);
        if (event?.type === 'reading' && event.id !== undefined) controller.finishReading(event.id);
        await sleep(10);
      }
      assert.equal(done, true, `${mode}: playback did not finish`);
      await play;
      assert.equal(
        (await vscode.workspace.openTextDocument(filename)).getText(),
        `head\n  value = (1 + 2)\n  triple = """hello"""\n\n  end = 3\n`,
      );
    }

    // A long line begins with real indentation, then crosses word and atomic quote boundaries.
    const longName = 'integration-block-boundary.py';
    const longPath = path.join(root, longName);
    fs.writeFileSync(longPath, 'head\n\n');
    await controller.read(longName);
    controller.setCodePlayback('blocks');
    const longText = `    ${'x'.repeat(235)}"""${' word'.repeat(60)}`;
    const prior = new Set(api.history());
    let longDone = false;
    const longPlay = (async () => {
      await controller.step([{ move: { file: longName, line: 2, to: 'line_end' } }, { type: `${longText}${CURSOR_MARKER}` }]);
      await controller.step([]);
    })();
    void longPlay.then(
      () => {
        longDone = true;
      },
      () => {
        longDone = true;
      },
    );
    for (let attempt = 0; attempt < 500; attempt++) {
      if (longDone) break;
      const event = api
        .history()
        .filter((item) => !prior.has(item))
        .findLast((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined);
      if (event?.type === 'reading' && event.id !== undefined) controller.finishReading(event.id);
      await sleep(10);
    }
    assert.equal(longDone, true, 'long block playback did not finish');
    await longPlay;
    assert.equal((await vscode.workspace.openTextDocument(longPath)).getText(), `head\n${longText}\n`);

    // Interrupting the reading pause leaves a partial group stopped, and a fully inserted group consumed.
    for (const [name, marked, expected] of [
      ['integration-interrupt-partial.py', `first\nsecond${CURSOR_MARKER}`, 'headfirst\n\n'],
      ['integration-interrupt-consumed.py', `first${CURSOR_MARKER}`, 'headfirst\n'],
    ] as const) {
      controller.endSession();
      await controller.start('integration code reading interrupt');
      controller.setCodePlayback('lines');
      const filename = path.join(root, name);
      fs.writeFileSync(filename, 'head\n');
      await controller.read(name);
      const before = new Set(api.history());
      const pending = controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type: marked }]);
      let reading = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        reading = api
          .history()
          .filter((item) => !before.has(item))
          .some((item) => item.type === 'reading' && item.owner === 'code');
        if (reading) break;
        await sleep(10);
      }
      assert.equal(reading, true, `${name}: no code reading event`);
      controller.userInterrupt();
      await pending;
      const document = await vscode.workspace.openTextDocument(filename);
      assert.equal(document.getText(), expected);
      await sleep(700);
      assert.equal(document.getText(), expected, `${name}: text advanced after interruption`);
    }
  } finally {
    controller.setCodePlayback('typing');
    controller.endSession();
    await settings.update('timing', undefined, global);
  }
  console.log('CodePlayback, ReadingHold: real line/block edits complete and held reading does not advance');
}

/** Allows the same scenario to run alone inside an isolated VS Code host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(extension, 'extension not found');
  const api = await extension.activate();
  await api.ready;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  await codePlaybackPaths(api, folder.uri.fsPath);
}
