// A programmer's message shows waiting until a report carries it to the agent (#117).
import * as assert from 'node:assert/strict';
import type { PanelEvent } from '@ai-pair/core';
import type { Api } from '../src/extension';

/** The text of the reply this case sends, unique in the run, to find it in a history the panel caps at 400 events. */
const TEXT = 'receipt check';

/** Returns the receipt events the panel logged after the reply this case sent. */
function receiptsAfterReply(api: Api): Array<Extract<PanelEvent, { type: 'receipt' }>> {
  const history = api.history();
  const sent = history.findLastIndex((event) => event.type === 'programmer' && event.text === TEXT);
  return history.slice(sent + 1).filter((event): event is Extract<PanelEvent, { type: 'receipt' }> => event.type === 'receipt');
}

/**
 * Sends a reply through the real panel and controller, then checks specs/MessageReceipt.tla's Send, Report,
 * RestoreUnseen and RestoreRepeat in the extension's own history: NoFalseReceipt and NoSeenWaiting.
 */
export async function messageReceiptPaths(api: Api): Promise<void> {
  const { controller } = api;
  await controller.start('message receipts');
  api.panelMessage({ type: 'reply', text: TEXT, attach: false });
  const sent = api.history().findLast((event) => event.type === 'programmer' && event.text === TEXT);
  assert.ok(sent?.type === 'programmer' && sent.receipt !== undefined, 'the message carried no receipt');
  const receipt = sent.receipt;
  assert.deepEqual(receiptsAfterReply(api), [], 'the message showed received before a report');
  const report = await controller.listen();
  assert.deepEqual(receiptsAfterReply(api), [{ type: 'receipt', ids: [receipt], received: true }]);
  controller.restore(report);
  assert.deepEqual(receiptsAfterReply(api).at(-1), { type: 'receipt', ids: [receipt], received: false });
  const again = await controller.listen();
  assert.deepEqual(receiptsAfterReply(api).at(-1), { type: 'receipt', ids: [receipt], received: true });
  const count = receiptsAfterReply(api).length;
  controller.restore(again, /* mayRepeat= */ true);
  assert.equal(receiptsAfterReply(api).length, count, 'a report the agent may have seen made its message wait');
  await controller.listen();
  await controller.end();
  console.log('a reply shows waiting until a report carries it, waits again only if put back unseen');
}
