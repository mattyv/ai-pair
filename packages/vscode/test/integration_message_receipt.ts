// A programmer's message shows waiting until a report carries it to the agent (#117).
import * as assert from 'node:assert/strict';
import type { PanelEvent } from '@ai-pair/core';
import type { Api } from '../src/extension';

/** Returns the receipt events the panel logged after `from`. */
function receiptsAfter(api: Api, from: number): Array<Extract<PanelEvent, { type: 'receipt' }>> {
  return api
    .history()
    .slice(from)
    .filter((event): event is Extract<PanelEvent, { type: 'receipt' }> => event.type === 'receipt');
}

/**
 * Sends a reply through the real panel and controller, then checks specs/MessageReceipt.tla's Send, Report,
 * RestoreUnseen and RestoreRepeat in the extension's own history: NoFalseReceipt and NoSeenWaiting.
 */
export async function messageReceiptPaths(api: Api): Promise<void> {
  const { controller } = api;
  await controller.start('message receipts');
  const before = api.history().length;
  api.panelMessage({ type: 'reply', text: 'receipt check', attach: false });
  const sent = api
    .history()
    .slice(before)
    .find((event) => event.type === 'programmer' && event.text === 'receipt check');
  assert.ok(sent?.type === 'programmer' && sent.receipt !== undefined, 'the message carried no receipt');
  const receipt = sent.receipt;
  assert.deepEqual(receiptsAfter(api, before), [], 'the message showed received before a report');
  const report = await controller.listen();
  assert.deepEqual(receiptsAfter(api, before), [{ type: 'receipt', ids: [receipt], received: true }]);
  controller.restore(report);
  assert.deepEqual(receiptsAfter(api, before).at(-1), { type: 'receipt', ids: [receipt], received: false });
  const again = await controller.listen();
  assert.deepEqual(receiptsAfter(api, before).at(-1), { type: 'receipt', ids: [receipt], received: true });
  const count = receiptsAfter(api, before).length;
  controller.restore(again, /* mayRepeat= */ true);
  assert.equal(receiptsAfter(api, before).length, count, 'a report the agent may have seen made its message wait');
  await controller.listen();
  await controller.end();
  console.log('a reply shows waiting until a report carries it, waits again only if put back unseen');
}
