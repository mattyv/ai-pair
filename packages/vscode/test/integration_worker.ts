// Exercises a separate worker connection against the packaged extension host.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, discoveryDir, REPORT_SCHEMA } from '@ai-pair/protocol';
import { z } from 'zod';
import { EditorLink } from '../../relay/src/link';
import type { Api } from '../src/extension';

const GRANT = z.object({ port: z.number(), capability: z.string().min(1) });
const BATCH = z.object({ status: z.string() });

/** Exercises opt-in, a separate worker's visible edit, and grant revocation. */
export async function workerPaths(api: Api, root: string): Promise<void> {
  const setting = vscode.workspace.getConfiguration('aiPair');
  const oldEnabled = setting.inspect<boolean>('worker.enabled')?.globalValue;
  const name = 'integration-worker.txt';
  const filename = path.join(root, name);
  const owner = new EditorLink(root, discoveryDir());
  let started = false;
  try {
    await setting.update('worker.enabled', undefined, vscode.ConfigurationTarget.Global);
    assert.equal(setting.get('worker.enabled'), false, 'worker editing must default off');
    fs.writeFileSync(filename, 'before\n');
    await owner.call('start', { task: 'worker integration', cwd: root });
    started = true;
    await assert.rejects(owner.call('worker_grant', { brief: 'edit scratch file' }));
    await setting.update('worker.enabled', true, vscode.ConfigurationTarget.Global);
    const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'edit scratch file' }));
    await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
    await owner.callWorker(grant.port, 'worker_progress', { capability: grant.capability, text: 'editing scratch file' });
    const batch = BATCH.parse(
      await owner.callWorker(grant.port, 'worker_step', {
        capability: grant.capability,
        actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type: ` after${CURSOR_MARKER}` }],
      }),
    );
    assert.equal(batch.status, 'completed');
    const document = await vscode.workspace.openTextDocument(filename);
    assert.equal(document.getText(), 'before after\n');
    await owner.callWorker(grant.port, 'worker_done', { capability: grant.capability, text: 'scratch edit complete' });
    const report = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(report.events.some((event) => event.kind === 'worker_complete' && event.text === 'scratch edit complete'));
    assert.ok(api.history().some((event) => event.type === 'workerActivity' && event.phase === 'progress'));
    assert.ok(api.history().some((event) => event.type === 'workerActivity' && event.phase === 'completed'));
    await assert.rejects(owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name }));

    const next = GRANT.parse(await owner.call('worker_grant', { brief: 'test revocation' }));
    await setting.update('worker.enabled', false, vscode.ConfigurationTarget.Global);
    await assert.rejects(owner.callWorker(next.port, 'worker_read', { capability: next.capability, file: name }));
    const stopped = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(stopped.events.some((event) => event.kind === 'worker_complete'));
    await owner.call('end', {});
    started = false;
    await document.save();
  } finally {
    if (started) api.controller.endSession();
    owner.close();
    await setting.update('worker.enabled', oldEnabled, vscode.ConfigurationTarget.Global);
    fs.rmSync(filename, { force: true });
  }
}
