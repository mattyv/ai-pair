// Exercises command-result wakeup with a real player and terminal in VS Code.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Waits for a condition without advancing the controller's heartbeat. */
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** Bounds a native test wait and clears its timer after settlement. */
async function within<T>(promise: Promise<T>, message: string, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Delivers a real command result while a later accepted batch is still playing. */
export async function commandDeliveryPaths(api: Api): Promise<void> {
  const { controller } = api;
  const originalTerminals = new Set(vscode.window.terminals);
  const confirmCommands = vscode.workspace.getConfiguration('aiPair').get<boolean>('confirmCommands', true);
  const previousTrace = controller.trace;
  const traces: string[] = [];
  controller.trace = (line) => {
    traces.push(line);
    previousTrace?.(line);
  };
  controller.setConfirmCommands(false);
  try {
    for (const kind of ['listen', 'empty step'] as const) {
      traces.length = 0;
      const priorHistory = new Set(api.history());
      await controller.start(`command delivery ${kind}`);
      const first = await controller.step([{ run: 'sleep 2; printf command-delivery-first' }]);
      assert.equal(first.submitted?.status, 'playing');
      const cancel = new AbortController();
      const queued = controller.step(
        [{ say: 'A later explanation remains visible while the first command result is delivered. '.repeat(2) }],
        cancel.signal,
      );
      await waitFor(() => traces.some((line) => line.startsWith('batch 2 queued:')), 'later batch was not accepted');
      assert.ok(
        api.history().some((event) => !priorHistory.has(event) && event.type === 'state' && event.ready === 1),
        'queued work was not shown as ready',
      );
      cancel.abort();
      await assert.rejects(queued, /cancel/i);
      const began = Date.now();
      const waiting = kind === 'listen' ? controller.listen() : controller.step([]);
      const result = await within(waiting, `${kind} did not receive the command result promptly`);
      assert.ok(Date.now() - began < 8000, `${kind} waited too long`);
      assert.equal(result.waiting, undefined, 'result waited for the heartbeat');
      assert.deepEqual(
        result.batches.map((batch) => batch.id),
        [1],
      );
      assert.equal(result.batches[0]?.runs?.[0]?.command, 'sleep 2; printf command-delivery-first');
      assert.match(result.batches[0]?.runs?.[0]?.output ?? '', /command-delivery-first/);
      assert.ok(traces.includes('batch 2 playing'), 'later work had not started');
      assert.ok(!traces.includes('batch 2 completed'), 'later work had already completed');
      const later = await within(controller.step([]), 'later batch did not finish', 20_000);
      assert.deepEqual(
        later.batches.map((batch) => batch.id),
        [2],
        'command result was lost or repeated',
      );
      assert.equal(later.batches[0]?.status, 'completed');
      await controller.end();
      for (const terminal of vscode.window.terminals) {
        if (!originalTerminals.has(terminal)) terminal.dispose();
      }
      await waitFor(() => vscode.window.terminals.every((terminal) => originalTerminals.has(terminal)), 'test terminals did not close');
    }
    // A quiet completed batch is not command news: an empty step must wait for later work.
    traces.length = 0;
    await controller.start('quiet delivery');
    const first = await controller.step([{ say: 'The first quiet explanation is still playing.' }]);
    assert.equal(first.submitted?.status, 'playing');
    const abort = new AbortController();
    const queued = controller.step(
      [{ say: 'The later quiet explanation remains visible while the empty step is waiting. '.repeat(2) }],
      abort.signal,
    );
    await waitFor(() => traces.some((line) => line.startsWith('batch 2 queued:')), 'later quiet batch was not accepted');
    abort.abort();
    await assert.rejects(queued, /cancel/i);
    await waitFor(() => traces.includes('batch 2 playing'), 'later quiet batch did not start');
    assert.ok(!traces.includes('batch 2 completed'), 'later quiet batch already completed');
    let returned = false;
    const empty = controller.step([]).then((report) => {
      returned = true;
      return report;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    assert.equal(returned, false, 'quiet completion incorrectly woke the empty step');
    const report = await within(empty, 'quiet batches did not finish', 20_000);
    assert.deepEqual(
      report.batches.map((batch) => batch.id),
      [1, 2],
    );
    assert.ok(report.batches.every((batch) => batch.status === 'completed' && batch.runs === undefined));
    await controller.end();
    console.log('CommandDelivery NoQuietWake: empty step waited for later work after quiet completion');

    console.log('CommandDelivery: listen and empty step deliver command output once while later work plays');
  } catch (error) {
    console.error('CommandDelivery trace:', JSON.stringify(traces));
    throw error;
  } finally {
    controller.endSession();
    for (const terminal of vscode.window.terminals) {
      if (!originalTerminals.has(terminal)) terminal.dispose();
    }
    controller.trace = previousTrace;
    controller.setConfirmCommands(confirmCommands);
    await waitFor(() => vscode.window.terminals.every((terminal) => originalTerminals.has(terminal)), 'test terminals did not close');
  }
}
