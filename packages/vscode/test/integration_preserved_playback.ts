// Real editor regressions retained from the speech settings worktree.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, type Action, type Report } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Checks grouped replacements, structural edits, and reading controls in VS Code. */
export async function preservedPlaybackPaths(api: Api, root: string): Promise<void> {
  const controller = api.controller;
  const global = vscode.ConfigurationTarget.Global;
  const previous = vscode.workspace.getConfiguration('aiPair').inspect('timing')?.globalValue;
  function file(name: string): string {
    return path.join(root, name);
  }
  async function text(name: string): Promise<string> {
    return (await vscode.workspace.openTextDocument(file(name))).getText();
  }
  function seenReadings(): Set<number> {
    return new Set(api.history().flatMap((event) => (event.type === 'reading' && event.id !== undefined ? [event.id] : [])));
  }
  async function reading(seen: Set<number>, owner?: 'code'): Promise<number> {
    for (let attempt = 0; attempt < 400; attempt++) {
      const event = api
        .history()
        .findLast(
          (item) => item.type === 'reading' && item.id !== undefined && !seen.has(item.id) && (owner === undefined || item.owner === owner),
        );
      if (event?.type === 'reading' && event.id !== undefined) return event.id;
      await sleep(10);
    }
    return assert.fail('reading countdown did not appear');
  }
  async function played(actions: Action[]): Promise<Report> {
    const accepted = await controller.step(actions);
    assert.equal(accepted.rejected, undefined, JSON.stringify(accepted));
    const report = await controller.step([]);
    assert.ok(
      report.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(report),
    );
    return report;
  }
  await vscode.workspace.getConfiguration('aiPair').update(
    'timing',
    {
      type: { charMs: 0, jitter: 0, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
      reading: { minMs: 3000, msPerChar: 0 },
      beforeMoveMs: 0,
      afterMoveNearMs: 0,
      afterMoveFarMs: 0,
    },
    global,
  );
  controller.setSpeed(1);
  controller.setReadingSpeed(1);
  try {
    await controller.start('preserved playback regressions');
    for (const mode of ['lines', 'blocks'] as const) {
      const name = `preserved-${mode}.txt`;
      fs.writeFileSync(file(name), 'left OLD right\r\n');
      await controller.read(name);
      controller.setCodePlayback(mode);
      const seen = seenReadings();
      const pending = played([{ select: { file: name, line: 1, text: 'OLD' } }, { type: `one\r\n  two${CURSOR_MARKER}three` }]);
      let done = false;
      void pending.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      for (let attempt = 0; attempt < 400; attempt++) {
        if (done) break;
        const event = api
          .history()
          .findLast((item) => item.type === 'reading' && item.owner === 'code' && item.id !== undefined && !seen.has(item.id));
        if (event?.type === 'reading' && event.id !== undefined) controller.finishReading(event.id);
        await sleep(10);
      }
      assert.equal(done, true, `${mode} replacement did not finish`);
      const report = await pending;
      assert.equal(await text(name), 'left one\r\n  twothree right\r\n');
      const lines = [...(report.cursor?.lines ?? []), ...report.batches.flatMap((batch) => batch.code?.lines ?? [])];
      assert.ok(
        lines.some((line) => line.text.includes(`two${CURSOR_MARKER}three`)),
        JSON.stringify(lines),
      );
    }
    controller.setCodePlayback('typing');
    fs.writeFileSync(file('preserved-structure.py'), 'x = {}\n');
    await controller.read('preserved-structure.py');
    await played([
      { move: { file: 'preserved-structure.py', line: 1, at: `x = {${CURSOR_MARKER}}` } },
      { newline: { indent: '    ' } },
      { type: `"answer": 42${CURSOR_MARKER}` },
    ]);
    assert.equal(await text('preserved-structure.py'), 'x = {\n    "answer": 42\n}\n');
    fs.writeFileSync(file('preserved-nested.py'), 'x = ({})\n');
    await controller.read('preserved-nested.py');
    await played([
      { move: { file: 'preserved-nested.py', line: 1, at: `x = ({${CURSOR_MARKER}})` } },
      { move: { to: 'next_close' } },
      { type: `,${CURSOR_MARKER}` },
    ]);
    assert.equal(await text('preserved-nested.py'), 'x = ({},)\n');
    fs.writeFileSync(file('preserved-guard.py'), 'x = call((1))\n');
    await controller.read('preserved-guard.py');
    const anchor = { file: 'preserved-guard.py', line: 1, at: `x = call((1${CURSOR_MARKER}))` };
    const refused = await controller.step([{ move: anchor }, { move: { to: 'line_end' } }]);
    assert.equal(refused.rejected?.error.kind, 'invalid_action');
    assert.match(refused.rejected.error.message, /multiple closing brackets/);
    assert.equal(await text('preserved-guard.py'), 'x = call((1))\n');
    await played([{ move: anchor }, { move: { to: 'line_end', allow_multiple_closes: true } }, { type: `,${CURSOR_MARKER}` }]);
    assert.equal(await text('preserved-guard.py'), 'x = call((1)),\n');
    fs.writeFileSync(file('preserved-string.py'), 'name = "{}"\n');
    await controller.read('preserved-string.py');
    const unsafe = await controller.step([
      { move: { file: 'preserved-string.py', line: 1, at: `name = "{${CURSOR_MARKER}}"` } },
      { newline: { indent: '    ' } },
    ]);
    assert.equal(unsafe.rejected?.error.kind, 'invalid_action');
    assert.equal(await text('preserved-string.py'), 'name = "{}"\n');

    fs.writeFileSync(file('preserved-interrupt.txt'), '');
    await controller.read('preserved-interrupt.txt');
    controller.setCodePlayback('lines');
    let seen = seenReadings();
    await controller.step([
      { move: { file: 'preserved-interrupt.txt', line: 1, to: 'line_end' } },
      { type: `The first visible line.\nsecond${CURSOR_MARKER}tail` },
    ]);
    const codeId = await reading(seen, 'code');
    controller.holdReading(codeId, true);
    controller.pause();
    controller.releaseReadingHold();
    assert.equal(controller.isPaused, true);
    controller.userInterrupt();
    controller.resume();
    const interrupted = await controller.listen();
    const stopped = interrupted.batches.find((batch) => batch.status === 'interrupted');
    assert.ok(stopped, JSON.stringify(interrupted));
    assert.deepEqual(stopped.unplayed, [{ type: `second${CURSOR_MARKER}tail` }]);
    assert.equal(await text('preserved-interrupt.txt'), 'The first visible line.\n');
    controller.setCodePlayback('typing');

    seen = seenReadings();
    const first = 'Please read this longer message before moving to the next one.';
    const next = `Reading continued ${Date.now()} ${Math.random()}.`;
    await controller.step([{ say: first }, { say: next }]);
    const sayId = await reading(seen);
    controller.holdReading(sayId, true);
    controller.finishReading(sayId);
    await sleep(200);
    assert.equal(
      api.history().some((event) => event.type === 'say' && event.text === next),
      false,
    );
    controller.holdReading(sayId, false);
    controller.finishReading(sayId);
    const completed = await controller.step([]);
    assert.ok(
      completed.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(completed),
    );
    assert.ok(api.history().some((event) => event.type === 'say' && event.text === next));
    console.log('Preserved playback regressions passed');
  } finally {
    controller.endSession();
    // Restore the baseline expected by the integration suite; these controller values have no getters.
    controller.setCodePlayback('typing');
    controller.setSpeed(20);
    controller.setReadingSpeed(10);
    await vscode.workspace.getConfiguration('aiPair').update('timing', previous, global);
  }
}

/** Runs this fixture alone in an isolated extension host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(extension, 'extension not found');
  const api = await extension.activate();
  await api.ready;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  await preservedPlaybackPaths(api, folder.uri.fsPath);
}
