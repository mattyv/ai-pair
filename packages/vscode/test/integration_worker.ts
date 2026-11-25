// Exercises a separate worker connection against the packaged extension host.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CURSOR_MARKER,
  discoveryDir,
  REPORT_SCHEMA,
  WORKER_ACTION_LIMIT,
  WORKER_ACTION_SIZE_LIMIT,
  WORKER_CAPABILITY_LIMIT,
  WORKER_MESSAGE_ID_LIMIT,
  WORKER_PATH_LIMIT,
  WORKER_TEXT_LIMIT,
} from '@ai-pair/protocol';
import { z } from 'zod';
import { EditorLink } from '../../relay/src/link';
import type { Controller, NarrationPort, PanelEvent, PanelPort } from '@ai-pair/core';
import type { Api } from '../src/extension';

const GRANT = z.object({ port: z.number(), capability: z.string().min(1) });
const BATCH = z.object({ status: z.string() });
const OUTPUT_SETTLE_MS = 250;
const MODEL = 'integration-codex-model';
const POLL_MS = 20;
const RETIREMENT_TIMEOUT_MS = 10_000;

/** Waits for worker ownership to reach an observed state. */
async function waitForWorkerState(api: Api, busy: boolean): Promise<void> {
  const deadline = Date.now() + RETIREMENT_TIMEOUT_MS;
  while (api.controller.workerStatus().busy !== busy && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
  assert.equal(api.controller.workerStatus().busy, busy, 'worker did not reach the expected busy state');
}

/** Bounds a wait and always retires its deadline timer. */
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(label));
        }, RETIREMENT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Returns an observed interrupt while a worker's real file read is held in rehearsal. */
async function returnedDuringRehearsal(api: Api, owner: EditorLink, name: string): Promise<void> {
  api.controller.userInterrupt();
  const returned = await owner.call('listen', {});
  assert.ok(REPORT_SCHEMA.parse(returned).events.some((event) => event.kind === 'interrupt'));
  const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'rehearsal interleaving' }));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    api.controller.workerStep(grant.capability, [{ move: { file: name, line: 1, to: 'line_end' } }], aborted.signal),
    /cancelled/,
  );
  assert.deepEqual(api.controller.workerStatus(), { active: true, busy: false });
  await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
  const editor = api.editor;
  const original = Object.getOwnPropertyDescriptor(editor, 'getText');
  const getText = editor.getText.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let completed = false;
  try {
    Object.defineProperty(editor, 'getText', {
      configurable: true,
      value: async (file: string) => {
        entered.resolve();
        await release.promise;
        return getText(file);
      },
    });
    const work = owner.callWorker(grant.port, 'worker_step', {
      capability: grant.capability,
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    const failed = assert.rejects(work, /interrupted/);
    void failed.catch(() => {});
    await bounded(entered.promise, 'worker rehearsal did not reach the editor');
    owner.handBack(returned);
    await owner.call('worker_status', {});
    release.resolve();
    await failed;
    const restored = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(restored.events.some((event) => event.kind === 'interrupt'));
    api.controller.revokeWorker();
    await owner.call('listen', {});
    completed = true;
  } finally {
    if (!completed) api.controller.revokeWorker();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'worker rehearsal did not settle');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'getText');
      else Object.defineProperty(editor, 'getText', original);
    }
  }
}

/** Revokes a completed worker edit while its real advisory diagnostics are still pending. */
async function revokeDuringDiagnostics(api: Api, owner: EditorLink, name: string): Promise<void> {
  const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'retire after edit' }));
  const id = api.controller.activeWorkerId();
  assert.notEqual(id, undefined);
  await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
  const editor = api.editor;
  const original = Object.getOwnPropertyDescriptor(editor, 'diagnostics');
  const diagnostics = editor.diagnostics.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let completed = false;
  try {
    Object.defineProperty(editor, 'diagnostics', {
      configurable: true,
      value: async (file: string) => {
        entered.resolve();
        await release.promise;
        return diagnostics(file);
      },
    });
    const work = owner.callWorker(grant.port, 'worker_step', {
      capability: grant.capability,
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `y${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'worker edit did not reach diagnostics');
    api.controller.revokeWorker();
    release.resolve();
    assert.equal(BATCH.parse(await work).status, 'completed');
    assert.ok(api.history().some((event) => event.type === 'workerActivity' && event.id === id && event.phase === 'stopped'));
    assert.ok(!api.history().some((event) => event.type === 'workerActivity' && event.id === id && event.phase === 'batchDone'));
    await owner.call('listen', {});
    completed = true;
  } finally {
    if (!completed) api.controller.revokeWorker();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'worker diagnostics did not settle');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'diagnostics');
      else Object.defineProperty(editor, 'diagnostics', original);
    }
  }
}

/** Replaces the session while the completed worker edit waits for advisory diagnostics. */
async function replaceDuringDiagnostics(api: Api, owner: EditorLink, root: string, name: string): Promise<void> {
  const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'replace during diagnostics' }));
  await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
  const editor = api.editor;
  const original = Object.getOwnPropertyDescriptor(editor, 'diagnostics');
  const diagnostics = editor.diagnostics.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let completed = false;
  try {
    Object.defineProperty(editor, 'diagnostics', {
      configurable: true,
      value: async (file: string) => {
        entered.resolve();
        await release.promise;
        return diagnostics(file);
      },
    });
    const work = owner.callWorker(grant.port, 'worker_step', {
      capability: grant.capability,
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `z${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'worker replacement did not reach diagnostics');
    const previous = api.controller.saved?.sessionId;
    api.controller.endSession();
    await owner.call('start', { task: 'replacement after worker edit', cwd: root });
    assert.notEqual(api.controller.saved?.sessionId, previous);
    release.resolve();
    assert.equal(BATCH.parse(await work).status, 'completed');
    await waitForWorkerState(api, false);
    assert.equal(api.controller.workerStatus().active, false);
    completed = true;
  } finally {
    if (!completed) api.controller.revokeWorker();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'worker diagnostics did not settle');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'diagnostics');
      else Object.defineProperty(editor, 'diagnostics', original);
    }
  }
}

/** Replaces the session while the old worker edit is inside the editor boundary. */
async function replaceDuringPlayback(api: Api, owner: EditorLink, root: string, name: string): Promise<void> {
  const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'replace during playback' }));
  await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
  const editor = api.editor;
  const original = Object.getOwnPropertyDescriptor(editor, 'edit');
  const edit = editor.edit.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let completed = false;
  try {
    Object.defineProperty(editor, 'edit', {
      configurable: true,
      value: async (...args: Parameters<typeof editor.edit>) => {
        entered.resolve();
        await release.promise;
        return edit(...args);
      },
    });
    const work = owner.callWorker(grant.port, 'worker_step', {
      capability: grant.capability,
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `p${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'worker replacement did not reach the editor');
    const previous = api.controller.saved?.sessionId;
    api.controller.endSession();
    await owner.call('start', { task: 'replacement during worker playback', cwd: root });
    assert.notEqual(api.controller.saved?.sessionId, previous);
    release.resolve();
    assert.ok(['completed', 'interrupted'].includes(BATCH.parse(await work).status));
    await waitForWorkerState(api, false);
    assert.equal(api.controller.workerStatus().active, false);
    completed = true;
  } finally {
    if (!completed) api.controller.revokeWorker();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'worker playback did not settle');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'edit');
      else Object.defineProperty(editor, 'edit', original);
    }
  }
}

/** Rejects a worker batch when the real editor's cursor renderer fails at an attention boundary. */
async function failWorkerPlayback(api: Api, owner: EditorLink, name: string): Promise<void> {
  const grant = GRANT.parse(await owner.call('worker_grant', { brief: 'editor rendering failure' }));
  await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name });
  const editor = api.editor;
  const originalEdit = Object.getOwnPropertyDescriptor(editor, 'edit');
  const originalRender = Object.getOwnPropertyDescriptor(editor, 'renderCursor');
  const edit = editor.edit.bind(editor);
  const render = editor.renderCursor.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let armed = false;
  let failed = false;
  try {
    Object.defineProperty(editor, 'edit', {
      configurable: true,
      value: async (...args: Parameters<typeof editor.edit>) => {
        entered.resolve();
        await release.promise;
        return edit(...args);
      },
    });
    Object.defineProperty(editor, 'renderCursor', {
      configurable: true,
      value: (...args: Parameters<typeof editor.renderCursor>) => {
        if (armed && api.controller.isAttentionGranted) {
          armed = false;
          failed = true;
          throw new Error('injected cursor renderer failure');
        }
        render(...args);
      },
    });
    const work = owner.callWorker(grant.port, 'worker_step', {
      capability: grant.capability,
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `f${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'worker playback did not reach the editor');
    api.controller.requestAttention();
    armed = true;
    release.resolve();
    await assert.rejects(bounded(work, 'worker playback did not fail'));
    assert.equal(failed, true, 'the cursor renderer fault did not fire');
    await waitForWorkerState(api, false);
    assert.equal(api.controller.workerStatus().active, false);
    await owner.call('listen', {});
  } finally {
    armed = false;
    api.controller.revokeWorker();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'failed worker playback did not settle');
    } finally {
      if (originalEdit === undefined) Reflect.deleteProperty(editor, 'edit');
      else Object.defineProperty(editor, 'edit', originalEdit);
      if (originalRender === undefined) Reflect.deleteProperty(editor, 'renderCursor');
      else Object.defineProperty(editor, 'renderCursor', originalRender);
    }
  }
}

/** Requires a new worker to re-anchor after a real main-agent batch is interrupted. */
async function anchorAfterMainInterruption(api: Api, owner: EditorLink, name: string): Promise<void> {
  await owner.call('read', { file: name });
  const editor = api.editor;
  const original = Object.getOwnPropertyDescriptor(editor, 'edit');
  const edit = editor.edit.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let settled: Promise<void> | undefined;
  let completed = false;
  try {
    Object.defineProperty(editor, 'edit', {
      configurable: true,
      value: async (...args: Parameters<typeof editor.edit>) => {
        entered.resolve();
        await release.promise;
        return edit(...args);
      },
    });
    const work = owner.call('step', {
      actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type: `${'x'.repeat(1000)}${CURSOR_MARKER}` }],
    });
    settled = work.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'main edit did not reach the editor');
    api.controller.userInterrupt();
    release.resolve();
    const first = REPORT_SCHEMA.parse(await work);
    const second = REPORT_SCHEMA.parse(await owner.call('step', { actions: [] }));
    assert.ok([...first.batches, ...second.batches].some((batch) => batch.status === 'interrupted'));
    const grant = GRANT.parse(await owner.call('worker_grant', { brief: 're-anchor after interruption' }));
    await assert.rejects(
      owner.callWorker(grant.port, 'worker_step', { capability: grant.capability, actions: [{ move: { line: 1, to: 'line_end' } }] }),
      /anchored/,
    );
    api.controller.revokeWorker();
    await owner.call('listen', {});
    completed = true;
  } finally {
    if (!completed) api.controller.userInterrupt();
    release.resolve();
    try {
      if (settled !== undefined) await bounded(settled, 'main playback did not settle');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'edit');
      else Object.defineProperty(editor, 'edit', original);
    }
  }
}

/** Exercises supported optional narration ports with the extension-bundled controller and real editor. */
async function workerNarrationPorts(api: Api): Promise<void> {
  const prototype: unknown = Object.getPrototypeOf(api.controller);
  assert.ok(typeof prototype === 'object' && prototype !== null && 'constructor' in prototype);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const ControllerConstructor = prototype.constructor as typeof Controller;
  const events: PanelEvent[] = [];
  const panel: PanelPort = {
    post: (event) => {
      events.push(event);
    },
  };
  const spoken: string[] = [];
  const basic: NarrationPort = {
    speak: (text) => {
      spoken.push(text);
      return Promise.resolve();
    },
    attentionCue: () => Promise.resolve(),
    pause: () => {},
    resume: () => {},
    cancel: () => {},
  };
  const fallback = new ControllerConstructor(api.editor, panel, undefined, basic, { workerEnabled: () => true });
  try {
    await fallback.start();
    fallback.grantWorker();
    await fallback.workerSay('optional retirement fallback');
    assert.deepEqual(spoken, ['optional retirement fallback']);
  } finally {
    fallback.endSession();
  }
  const failing = new ControllerConstructor(
    api.editor,
    panel,
    undefined,
    {
      ...basic,
      waitForRetirement: () => Promise.reject(new Error('injected retirement failure')),
    },
    { workerEnabled: () => true },
  );
  try {
    await failing.start();
    failing.grantWorker();
    await failing.workerSay('shown despite retirement failure');
    assert.ok(events.some((event) => event.type === 'say' && event.text === 'shown despite retirement failure'));
    assert.deepEqual(spoken, ['optional retirement fallback']);
  } finally {
    failing.endSession();
  }
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<boolean>();
  const retiring = new ControllerConstructor(
    api.editor,
    panel,
    undefined,
    {
      ...basic,
      waitForRetirement: () => {
        entered.resolve();
        return release.promise;
      },
    },
    { workerEnabled: () => true },
  );
  let settled: Promise<void> | undefined;
  try {
    await retiring.start();
    retiring.grantWorker();
    const pending = retiring.workerSay('not spoken after retirement cancellation');
    settled = pending.then(
      () => {},
      () => {},
    );
    await bounded(entered.promise, 'worker narration did not reach retirement');
    retiring.revokeWorker();
    release.resolve(true);
    await bounded(pending, 'worker narration did not retire');
    assert.deepEqual(spoken, ['optional retirement fallback']);
  } finally {
    retiring.revokeWorker();
    release.resolve(false);
    try {
      if (settled !== undefined) await bounded(settled, 'worker narration cleanup did not settle');
    } finally {
      retiring.endSession();
    }
  }
}

/** Exercises opt-in, a separate worker's visible edit, and grant revocation. */
export async function workerPaths(api: Api, root: string): Promise<void> {
  const setting = vscode.workspace.getConfiguration('aiPair');
  const oldEnabled = setting.inspect<boolean>('worker.enabled')?.globalValue;
  const oldModel = setting.inspect<string>('worker.codexModel')?.globalValue;
  const oldSpeechEnabled = setting.inspect<boolean>('speech.enabled')?.globalValue;
  const name = 'integration-worker.txt';
  const filename = path.join(root, name);
  const owner = new EditorLink(root, discoveryDir());
  let started = false;
  try {
    await setting.update('worker.enabled', undefined, vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('worker.enabled'), false, 'worker editing must default off');
    fs.writeFileSync(filename, 'before\n');
    await setting.update('worker.codexModel', MODEL, vscode.ConfigurationTarget.Global);
    await owner.call('start', { task: 'worker integration', cwd: root, provider: 'codex' });
    started = true;
    await assert.rejects(owner.call('worker_grant', { brief: 'edit scratch file' }));
    await setting.update('worker.enabled', true, vscode.ConfigurationTarget.Global);
    await assert.rejects(owner.call('worker_grant', { brief: 'x'.repeat(WORKER_TEXT_LIMIT + 1) }));
    await setting.update('worker.codexModel', '   ', vscode.ConfigurationTarget.Global);
    const blankModel: unknown = await owner.call('worker_grant', { brief: 'use the provider default' });
    assert.equal(z.object({ model: z.string().optional() }).parse(blankModel).model, undefined);
    const defaultGrant = GRANT.parse(blankModel);
    await owner.callWorker(defaultGrant.port, 'worker_done', { capability: defaultGrant.capability, text: 'finished' });
    await owner.call('listen', {});
    await setting.update('worker.codexModel', MODEL, vscode.ConfigurationTarget.Global);
    const granted: unknown = await owner.call('worker_grant', { brief: 'edit scratch file' });
    assert.equal(z.object({ model: z.string() }).parse(granted).model, MODEL);
    const grant = GRANT.parse(granted);
    assert.deepEqual(await owner.call('worker_status', {}), { active: true, busy: false });
    await assert.rejects(owner.call('step', { actions: [{ say: 'not while worker is active' }] }));
    await assert.rejects(owner.call('worker_say', { text: '' }));
    await setting.update('speech.enabled', true, vscode.ConfigurationTarget.Global);
    await owner.call('worker_say', { text: 'Worker will edit.' });
    await setting.update('speech.enabled', oldSpeechEnabled, vscode.ConfigurationTarget.Global);
    const invalid: Array<[Parameters<EditorLink['callWorker']>[1], Record<string, unknown>]> = [
      ['worker_read', { capability: '', file: name }],
      ['worker_read', { capability: 'x'.repeat(WORKER_CAPABILITY_LIMIT + 1), file: name }],
      ['worker_read', { capability: grant.capability, file: '', from_line: 0 }],
      ['worker_read', { capability: grant.capability, file: 'x'.repeat(WORKER_PATH_LIMIT + 1) }],
      ['worker_read', { capability: grant.capability, file: name, from_line: 0 }],
      ['worker_read', { capability: grant.capability, file: name, to_line: 0 }],
      ['worker_step', { capability: grant.capability, actions: 'invalid' }],
      ['worker_step', { capability: grant.capability, actions: Array.from({ length: WORKER_ACTION_LIMIT + 1 }, () => ({ say: 'x' })) }],
      ['worker_step', { capability: grant.capability, actions: [{ say: 'x'.repeat(WORKER_ACTION_SIZE_LIMIT) }] }],
      ['worker_step', { capability: grant.capability, actions: [{ unsupported: true }] }],
      ['worker_step', { capability: grant.capability, actions: [] }],
      ['worker_step', { capability: grant.capability, actions: [{ say: 'unsupported' }] }],
      ['worker_step', { capability: grant.capability, actions: [{ type: 'unanchored' }] }],
      ['worker_step', { capability: grant.capability, actions: [{ move: { file: name, line: 1 } }, { type: 'missing cursor marker' }] }],
      ['worker_progress', { capability: grant.capability, text: '' }],
      ['worker_output', { capability: grant.capability, text: 'x', message: '' }],
      ['worker_output', { capability: grant.capability, text: 'x', message: 'x'.repeat(WORKER_MESSAGE_ID_LIMIT + 1) }],
      ['worker_output', { capability: grant.capability, text: 'x', message: 'm', final: false }],
      ['worker_output', { capability: grant.capability, text: 'x', final: true }],
      ['worker_output', { capability: grant.capability, text: 'x', message: grant.capability }],
      ['worker_notice', { capability: grant.capability, text: 'x', notice: 'invalid' }],
    ];
    for (const [tool, args] of invalid) await assert.rejects(owner.callWorker(grant.port, tool, args), `accepted invalid ${tool}`);
    await owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name, from_line: 1, to_line: 1 });
    await owner.callWorker(grant.port, 'worker_progress', { capability: grant.capability, text: 'editing scratch file' });
    const activity = api.history().findLast((event) => event.type === 'workerActivity' && event.phase === 'started');
    assert.ok(activity?.type === 'workerActivity', 'worker start is missing from history');
    assert.equal(api.controller.activeWorkerId(), activity.id);
    const raw = '  <worker & output>\n\tsecond line  \n';
    const pending = owner.call('listen', {});
    await owner.callWorker(grant.port, 'worker_output', { capability: grant.capability, text: raw });
    assert.ok(api.history().some((event) => event.type === 'workerOutput' && event.id === activity.id && event.text === raw));
    const prefix = grant.capability.slice(0, 5);
    await owner.callWorker(grant.port, 'worker_output', { capability: grant.capability, message: 'snapshot', text: `before ${prefix}` });
    assert.ok(
      api
        .history()
        .some(
          (event) => event.type === 'workerOutput' && event.id === activity.id && event.message === 'snapshot' && event.text === 'before ',
        ),
    );
    await owner.callWorker(grant.port, 'worker_output', {
      capability: grant.capability,
      message: 'snapshot',
      text: `before ${prefix}`,
      final: true,
    });
    assert.ok(
      api
        .history()
        .some(
          (event) =>
            event.type === 'workerOutput' && event.id === activity.id && event.message === 'snapshot' && event.text === `before ${prefix}`,
        ),
    );
    await owner.callWorker(grant.port, 'worker_output', {
      capability: grant.capability,
      message: 'redaction',
      text: `secret ${grant.capability}`,
      final: true,
    });
    assert.ok(
      api
        .history()
        .some(
          (event) =>
            event.type === 'workerOutput' &&
            event.id === activity.id &&
            event.message === 'redaction' &&
            event.text === 'secret [redacted]',
        ),
    );

    const early = await Promise.race([
      pending.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => {
          resolve(false);
        }, OUTPUT_SETTLE_MS);
      }),
    ]);
    assert.equal(early, false, 'raw output woke the owner listen');
    await owner.callWorker(grant.port, 'worker_notice', { capability: grant.capability, notice: 'question', text: 'Need guidance.' });
    const notice = REPORT_SCHEMA.parse(await pending);
    assert.ok(notice.events.some((event) => event.kind === 'worker_notice' && event.text === 'Need guidance.'));
    assert.ok(!JSON.stringify(notice).includes(JSON.stringify(raw)), 'raw output leaked into the owner report');
    api.controller.restore(notice);
    await owner.callWorker(grant.port, 'worker_notice', { capability: grant.capability, notice: 'blocked', text: 'Need a decision.' });
    const latest = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(
      latest.events.some((event) => event.kind === 'worker_notice' && event.notice === 'blocked' && event.text === 'Need a decision.'),
    );
    assert.equal(latest.events.filter((event) => event.kind === 'worker_notice').length, 1);
    const completion = owner.call('listen', {});

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
    assert.equal(api.controller.activeWorkerId(), undefined);
    const report = REPORT_SCHEMA.parse(await completion);
    assert.ok(!JSON.stringify(report).includes(JSON.stringify(raw)), 'raw output leaked into the owner report');
    await assert.rejects(owner.callWorker(grant.port, 'worker_output', { capability: grant.capability, text: 'late output' }));
    assert.ok(report.events.some((event) => event.kind === 'worker_complete' && event.text === 'scratch edit complete'));
    assert.ok(api.history().some((event) => event.type === 'workerActivity' && event.phase === 'progress'));
    assert.ok(api.history().some((event) => event.type === 'workerActivity' && event.phase === 'completed'));
    await assert.rejects(owner.callWorker(grant.port, 'worker_read', { capability: grant.capability, file: name }));

    const cancelled = GRANT.parse(await owner.call('worker_grant', { brief: 'cancel an active edit' }));
    const abort = new AbortController();
    const editing = owner.callWorker(
      cancelled.port,
      'worker_step',
      {
        capability: cancelled.capability,
        actions: [{ move: { file: name, line: 1, to: 'line_end' } }, { type: `${'x'.repeat(2000)}${CURSOR_MARKER}` }],
      },
      abort.signal,
    );
    const settled = editing.then(
      (value) => BATCH.parse(value).status,
      () => 'rejected',
    );
    await waitForWorkerState(api, true);
    await assert.rejects(owner.callWorker(cancelled.port, 'worker_done', { capability: cancelled.capability, text: 'too soon' }));
    await assert.rejects(
      owner.callWorker(cancelled.port, 'worker_step', { capability: cancelled.capability, actions: [{ move: { file: name, line: 1 } }] }),
    );
    abort.abort();
    assert.notEqual(await settled, 'completed', 'cancelled worker call unexpectedly completed');
    await waitForWorkerState(api, false);
    await assert.rejects(owner.callWorker(cancelled.port, 'worker_read', { capability: cancelled.capability, file: name }));
    await owner.call('listen', {});
    const next = GRANT.parse(await owner.call('worker_grant', {}));
    await setting.update('worker.enabled', false, vscode.ConfigurationTarget.Global);
    await assert.rejects(owner.callWorker(next.port, 'worker_read', { capability: next.capability, file: name }));
    const stopped = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(stopped.events.some((event) => event.kind === 'worker_complete'));
    await owner.call('end', {});
    started = false;
    await document.save();

    await setting.update('worker.enabled', true, vscode.ConfigurationTarget.Global);
    await owner.call('start', { task: 'worker with unknown provider', cwd: root });
    started = true;
    const unknownGrant: unknown = await owner.call('worker_grant', {});
    assert.equal(z.object({ model: z.string().optional() }).parse(unknownGrant).model, undefined);
    const unknown = GRANT.parse(unknownGrant);
    await owner.callWorker(unknown.port, 'worker_done', { capability: unknown.capability, text: 'finished' });
    await owner.call('listen', {});
    await owner.call('worker_grant', { brief: 'cancel pending narration' });
    const pendingSpeech = api.controller.workerSay('This must not be spoken after revocation.');
    api.controller.revokeWorker();
    await pendingSpeech;
    assert.ok(!api.history().some((event) => event.type === 'say' && event.text === 'This must not be spoken after revocation.'));
    const speechStopped = REPORT_SCHEMA.parse(await owner.call('listen', {}));
    assert.ok(speechStopped.events.some((event) => event.kind === 'worker_complete'));
    await returnedDuringRehearsal(api, owner, name);
    await revokeDuringDiagnostics(api, owner, name);
    await replaceDuringDiagnostics(api, owner, root, name);
    await replaceDuringPlayback(api, owner, root, name);
    await anchorAfterMainInterruption(api, owner, name);
    await failWorkerPlayback(api, owner, name);
    await owner.call('end', {});
    started = false;
    await workerNarrationPorts(api);
  } finally {
    if (started) api.controller.endSession();
    owner.close();
    await setting.update('worker.enabled', oldEnabled, vscode.ConfigurationTarget.Global);
    await setting.update('worker.codexModel', oldModel, vscode.ConfigurationTarget.Global);
    await setting.update('speech.enabled', oldSpeechEnabled, vscode.ConfigurationTarget.Global);
    fs.rmSync(filename, { force: true });
  }
}
