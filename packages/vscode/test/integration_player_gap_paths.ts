// Real-editor regressions for grouped playback cursor placement and interruption.
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

/** Exercises grouped edits in the real editor, including their reported cursor and remainder. */
export async function playerGapPaths(api: Api, root: string): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const previous = settings.inspect('timing')?.globalValue;
  const controller = api.controller;
  await settings.update(
    'timing',
    {
      type: { charMs: 0, jitter: 0, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
      reading: { minMs: 3000, msPerChar: 0 },
      fastFactor: 1,
      beforeMoveMs: 0,
      afterMoveNearMs: 0,
      afterMoveFarMs: 0,
    },
    global,
  );
  controller.setCodePlayback('lines');
  controller.setSpeed(1);
  controller.setReadingSpeed(1);
  try {
    for (const [suffix, eol] of [
      ['lf', '\n'],
      ['crlf', '\r\n'],
    ] as const) {
      controller.endSession();
      await controller.start(`grouped final marker ${suffix}`);
      const name = `integration-grouped-marker-${suffix}.txt`;
      const filename = path.join(root, name);
      fs.writeFileSync(filename, `head${eol}`);
      await controller.read(name);
      const seen = new Set(api.history().flatMap((item) => (item.type === 'reading' && item.id !== undefined ? [item.id] : [])));
      const submitted = await controller.step([
        { move: { file: name, line: 1, to: 'line_end' } },
        { type: `\nfirst\nse${CURSOR_MARKER}cond` },
      ]);
      let done = false;
      const pending = controller.step([]);
      void pending.finally(() => {
        done = true;
      });
      for (let i = 0; i < 500; i++) {
        if (done) break;
        const reading = api
          .history()
          .findLast((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined && !seen.has(item.id));
        if (reading?.type === 'reading' && reading.id !== undefined) controller.finishReading(reading.id);
        await sleep(10);
      }
      if (!done) {
        const current = await vscode.workspace.openTextDocument(filename);
        assert.fail(
          `${suffix}: grouped typing did not finish: ${JSON.stringify({
            submitted,
            text: current.getText(),
            paused: controller.isPaused,
            active: controller.isActive,
            suspended: controller.isSuspended,
            recentReadings: api
              .history()
              .filter((item) => item.type === 'reading')
              .slice(-5),
          })}`,
        );
      }
      const report = await pending;
      assert.equal(
        report.batches.some((batch) => batch.status === 'completed'),
        true,
      );
      const document = await vscode.workspace.openTextDocument(filename);
      assert.equal(document.getText(), `head${eol}first${eol}second${eol}`);
      const reportedLines = [...(report.cursor?.lines ?? []), ...report.batches.flatMap((batch) => batch.code?.lines ?? [])];
      assert.ok(
        reportedLines.some((line) => line.text.includes(`se${CURSOR_MARKER}cond`)),
        `${suffix}: wrong cursor position: ${JSON.stringify(reportedLines)}`,
      );
    }

    for (const fast of [false, true]) {
      controller.endSession();
      await controller.start('interrupt grouped typing after marker');
      const name = `integration-grouped-interrupt-${fast ? 'fast' : 'normal'}.txt`;
      const filename = path.join(root, name);
      fs.writeFileSync(filename, 'head\n');
      await controller.read(name);
      const seen = new Set(api.history().flatMap((item) => (item.type === 'reading' && item.id !== undefined ? [item.id] : [])));
      const text = `ab${CURSOR_MARKER}cd\nsecond`;
      const typing: Action = fast ? { type_fast: text } : { type: text };
      await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, typing]);
      const pending = controller.step([]);
      let reading = false;
      for (let i = 0; i < 200 && !reading; i++) {
        reading = api
          .history()
          .some((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined && !seen.has(item.id));
        if (!reading) await sleep(10);
      }
      assert.equal(reading, true, 'grouped typing did not enter its first reading pause');
      const document = await vscode.workspace.openTextDocument(filename);
      assert.equal(document.getText(), 'headabcd\n\n');
      controller.userInterrupt();
      const report = await pending;
      const stopped = report.batches.find((batch) => batch.status === 'interrupted');
      assert.ok(stopped, 'grouped typing did not report interruption');
      assert.deepEqual(stopped.unplayed?.[0], fast ? { type_fast: `${CURSOR_MARKER}second` } : { type: `${CURSOR_MARKER}second` });
      assert.equal(document.getText(), 'headabcd\n\n', 'the later group must remain untyped');
    }
  } finally {
    controller.endSession();
    controller.setCodePlayback('typing');
    controller.setSpeed(20);
    await settings.update('timing', previous, global);
  }
}

/** Runs these cases alone in an isolated VS Code extension host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(extension, 'extension not found');
  const api = await extension.activate();
  await api.ready;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  await playerGapPaths(api, folder.uri.fsPath);
}
