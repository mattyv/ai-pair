// A reply sent while the agent waits in listen reaches it without a false pause (#125).
import * as assert from 'node:assert/strict';
import type { Api } from '../src/extension';

/** How long the agent's listen is left waiting before the reply, past its grace period. */
const WAIT_MS = 1000;

/**
 * Types and sends a reply through the real panel while the agent's listen waits, as a programmer does, and checks
 * specs/ReplyReport.tla's NoPausedReply: the report carries the message and no pause, and nothing is left paused.
 */
export async function replyReportPaths(api: Api): Promise<void> {
  const { controller } = api;
  await controller.start('reply while listening');
  const listening = controller.listen();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, WAIT_MS);
  });
  api.panelMessage({ type: 'draft', empty: false });
  assert.equal(controller.isPaused, true, 'typing a reply did not pause playback');
  api.panelMessage({ type: 'reply', text: 'But anyway.', attach: false });
  const report = await listening;
  assert.deepEqual(
    report.events.map((event) => event.kind),
    ['message'],
  );
  assert.equal(report.paused, undefined, 'the reply reached the agent with a pause it had just ended');
  assert.equal(controller.isPaused, false, 'the reply left playback paused');
  await controller.end();
  console.log('a reply sent while the agent listens reaches it with no pause');
}
