// Real VS Code integration for the player's selected narration and structural moves, and the reading clock's
// controls on a `say`. Speech is off here, so a selected narration resolves at once and nothing is played aloud.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, type Action, type ErrorKind, type Report } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** A reading time long enough to hold, pause, and release inside. */
const READING_MS = 4000;

/** How often, and how many times, to look for a reading to start. */
const POLL_MS = 20;
const POLLS = 400;

/** A reading id no reading has. */
const UNKNOWN_READING = 999_999;

/** More characters than a selected narration may have. */
const TOO_LONG = 300;

/** More words than a selected narration may have. */
const TOO_MANY_WORDS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Plays the narration refusals, the structural moves, and the reading clock's controls on a `say`. */
export async function corePaths(api: Api, root: string): Promise<void> {
  const { controller } = api;
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  function file(name: string): string {
    return path.join(root, name);
  }
  /** Sends a batch that must be refused with `kind`, and returns the report. */
  async function refused(actions: object[], kind: ErrorKind, message?: RegExp): Promise<Report> {
    // Some of these are actions the relay's schema would refuse; the editor refuses them all the same.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const report = await controller.step(actions as Action[]);
    assert.equal(report.rejected?.error.kind, kind, `${JSON.stringify(actions)}: ${JSON.stringify(report)}`);
    if (message !== undefined) {
      assert.match(report.rejected.error.message, message);
    }
    return report;
  }
  /** Plays a batch to its end and returns the report. */
  async function played(actions: Action[]): Promise<Report> {
    await controller.step(actions);
    return controller.step([]);
  }
  /** Returns the highest id of a reading the panel was shown, or 0. */
  function lastReadingId(): number {
    return api.history().reduce((most, item) => (item.type === 'reading' && item.id !== undefined ? Math.max(most, item.id) : most), 0);
  }
  /** Waits for a reading of a `say` (not of code) to start, and returns its id. */
  async function sayReading(after: number): Promise<number> {
    for (let i = 0; i < POLLS; i++) {
      // The panel's log is capped, so a reading is told by its id, which only grows.
      const event = api
        .history()
        .findLast((item) => item.type === 'reading' && item.owner === undefined && item.id !== undefined && item.id > after);
      if (event?.type === 'reading' && event.id !== undefined) {
        return event.id;
      }
      await sleep(POLL_MS);
    }
    return assert.fail('the panel never showed a reading of a say');
  }

  // With no session, the reading clock's controls go nowhere (specs/Timeline.tla).
  assert.equal(controller.isActive, false);
  controller.finishReading(UNKNOWN_READING);
  controller.holdReading(UNKNOWN_READING, true);
  controller.releaseReadingHold();

  await settings.update('timing', { reading: { minMs: READING_MS, msPerChar: 0 } }, global);
  controller.setSpeed(20);
  controller.setReadingSpeed(1);
  controller.setConfirmCommands(false);
  try {
    fs.writeFileSync(file('core-pairs.py'), 'x = f()\ny = g(h(1))\n');
    fs.writeFileSync(file('core-pairs.txt'), 'plain()\n');
    await controller.start('core paths');

    // A move or a newline before the cursor is in a file names one.
    await refused([{ newline: { indent: '    ' } }], 'file_required');

    // Fields the editor holds an action to, as the schema does: `speak` is a boolean, `newline` has a plain indent,
    // and a cursor cannot sit inside a CRLF line end.
    await refused([{ say: 'a', speak: 'yes' }], 'invalid_action', /`speak` must be a boolean/);

    // A selected narration is one unit of at most 45 words, in plain text, and one at a time.
    await controller.read('core-pairs.py');
    for (const newline of [{ indent: '' }, { indent: ' ', extra: 1 }]) {
      await refused(
        [{ move: { file: 'core-pairs.py', line: 1, to: 'line_end' } }, { newline }],
        'invalid_action',
        /`newline` takes a nonempty `indent`/,
      );
    }
    await refused(
      [{ move: { file: 'core-pairs.py', line: 1, to: 'line_end' } }, { type: `a\r${CURSOR_MARKER}\nb` }],
      'invalid_action',
      /not inside it/,
    );
    await refused(
      [
        { say: 'One.', speak: true },
        { say: 'Two.', speak: true },
      ],
      'invalid_action',
      /only one selected narration/i,
    );
    for (const text of ['  ', 'Look: ```code```', 'x'.repeat(TOO_LONG), Array.from({ length: TOO_MANY_WORDS }, () => 'w').join(' ')]) {
      await refused([{ say: text, speak: true }], 'invalid_action', /spoken `say` must be plain/);
    }

    // A reading of a selected narration ends at its time; the clock's controls act only on the reading shown.
    let before = lastReadingId();
    await controller.step([{ say: 'Selected narration.', speak: true }]);
    // One queued behind another is refused until the first has been reported.
    await refused([{ say: 'Another.', speak: true }], 'invalid_action', /Wait for the current narration/);
    const id = await sayReading(before);
    controller.finishReading(UNKNOWN_READING);
    controller.holdReading(UNKNOWN_READING, true);
    controller.holdReading(id, true);
    // Held already, a second hold changes nothing, and nor does a finish.
    controller.holdReading(id, true);
    controller.finishReading(id);
    // A global pause with the hold on: the resume leaves the hold, and a release under a pause leaves the pause.
    controller.pause();
    controller.finishReading(id);
    controller.resume();
    controller.holdReading(id, false);
    controller.holdReading(id, false);
    controller.pause();
    controller.holdReading(id, true);
    controller.releaseReadingHold();
    controller.resume();
    await sleep(READING_MS / 4);
    assert.ok(lastReadingId() >= id);
    controller.finishReading(id);
    const narrated = await controller.step([]);
    assert.ok(
      narrated.batches.some((b) => b.status === 'completed'),
      JSON.stringify(narrated),
    );

    // An interrupt while the reading is held leaves the held `say` stopped.
    before = lastReadingId();
    await controller.step([{ say: 'Held, then interrupted.', speak: true }]);
    const heldId = await sayReading(before);
    controller.holdReading(heldId, true);
    controller.userInterrupt();
    const interrupted = await controller.listen();
    assert.notEqual(interrupted.batches[0]?.status, 'completed', JSON.stringify(interrupted));

    // A pause and a resume with nothing sleeping change nothing.
    controller.pause();
    controller.resume();

    // The moves that need no line: a bracket right after the cursor, and a line end past several.
    await controller.read('core-pairs.py');
    // After the interrupted batch, the cursor is anchored again by a move that names its place.
    await played([{ move: { file: 'core-pairs.py', line: 1, at: `x = ${CURSOR_MARKER}f()` } }]);
    await refused([{ move: { to: 'next_close' } }], 'invalid_action', /requires one closing bracket/);
    await refused([{ move: { file: 'core-pairs.py', line: 1, to: 'next_close' } }], 'invalid_action', /acts at the current cursor/);
    await refused(
      [{ move: { file: 'core-pairs.py', line: 1, at: `x = f(${CURSOR_MARKER})`, allow_multiple_closes: true } }],
      'invalid_action',
      /allow_multiple_closes/,
    );
    await played([{ move: { file: 'core-pairs.py', line: 2, at: `y = g(h(1${CURSOR_MARKER}))` } }]);
    await refused([{ move: { line: 2, to: 'line_end' } }], 'invalid_action', /multiple closing brackets/);
    await played([{ move: { line: 2, to: 'line_end', allow_multiple_closes: true } }]);
    await played([{ move: { file: 'core-pairs.py', line: 2, at: `y = g(h(1${CURSOR_MARKER}))` } }, { move: { to: 'next_close' } }]);

    // `newline` splits an adjacent pair in Python or JSON, and nothing else.
    await played([{ move: { file: 'core-pairs.py', line: 1, at: `x = f(${CURSOR_MARKER})` } }, { newline: { indent: '    ' } }]);
    assert.equal((await vscode.workspace.openTextDocument(file('core-pairs.py'))).lineAt(1).text, '    ');
    await refused(
      [{ select: { file: 'core-pairs.py', line: 1, text: 'x' } }, { newline: { indent: '    ' } }],
      'invalid_action',
      /unselected cursor/,
    );
    await controller.read('core-pairs.txt');
    await refused(
      [{ move: { file: 'core-pairs.txt', line: 1, at: `plain(${CURSOR_MARKER})` } }, { newline: { indent: '  ' } }],
      'invalid_action',
      /adjacent matching pair/,
    );

    // An edit to a Python file comes back with the errors VS Code holds for it, and with the syntax check's own.
    fs.writeFileSync(file('core-errors.py'), 'x = 1\n');
    await controller.read('core-errors.py');
    const errors = vscode.languages.createDiagnosticCollection('ai-pair-integration');
    errors.set(vscode.Uri.file(file('core-errors.py')), [
      new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'injected error', vscode.DiagnosticSeverity.Error),
    ]);
    const checked = await played([{ move: { file: 'core-errors.py', line: 1, to: 'line_end' } }, { type: `\ndef (${CURSOR_MARKER}` }]);
    errors.dispose();
    assert.match(JSON.stringify(checked), /injected error/);
    assert.match(JSON.stringify(checked), /python3/);

    // With the terminals shown automatically, a command's terminal comes into view, and the panel can show it again
    // by the run's id; an id that has no terminal is refused (specs/QuietTerminals.tla).
    await settings.update('showTerminalsAutomatically', true, global);
    await played([{ run: 'echo shown' }]);
    const shown = api.history().findLast((e) => e.type === 'run' && e.command === 'echo shown');
    assert.ok(shown?.type === 'run', 'the panel never showed the run');
    assert.equal(typeof api.editor.showTerminal(shown.id), 'boolean');
    assert.equal(api.editor.showTerminal(UNKNOWN_READING), false);
    // A terminal the programmer closes while a command runs in it ends the command.
    const closing = played([{ run: 'sleep 30', wait: 20 }]);
    await sleep(READING_MS / 2);
    for (const terminal of vscode.window.terminals) {
      terminal.dispose();
    }
    const closedReport = await closing;
    assert.ok(closedReport.batches.length > 0, JSON.stringify(closedReport));
  } finally {
    await settings.update('showTerminalsAutomatically', undefined, global);
    controller.endSession();
    controller.setReadingSpeed(10);
    await settings.update('timing', undefined, global);
  }
  console.log('the player: selected narration, structural moves, and the reading clock on a say');
}
