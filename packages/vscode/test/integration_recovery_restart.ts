// Checks batch IDs across two real VS Code processes sharing workspace storage.
import * as assert from 'node:assert/strict';
import type { Api } from '../src/extension';

/** Allocates and reports a batch before VS Code exits. */
export async function prepareRecovery(api: Api): Promise<void> {
  await api.controller.step([{ say: 'Before restart.' }]);
  const report = await api.controller.step([]);
  assert.equal(report.batches.length, 1);
  assert.equal(report.batches[0]?.id, 1);
}

/** Resumes the persisted session and checks its next allocation. */
export async function verifyRecovery(api: Api): Promise<void> {
  assert.equal((await api.controller.start()).resumed, true);
  await api.controller.step([{ say: 'After restart.' }]);
  const report = await api.controller.step([]);
  assert.equal(report.batches.length, 1);
  assert.equal(report.batches[0]?.id, 2);
}
