// Real VS Code integration for raising a hand (specs/Attention.tla), revealing the agent cursor
// (specs/RevealCursor.tla), and the navigator commentary preference (specs/NavigatorCommentary.tla): through the
// Pair panel's own message handler, the controller, the bridge, and the relay an agent connects through.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CURSOR_MARKER, discoveryDir, type Report } from '@ai-pair/protocol';
import { defaultConfig, type Controller, type PanelEvent } from '@ai-pair/core';
import { EditorLink } from '../../relay/src/link';
import type { Api } from '../src/extension';

/** How long a call waits here before it reports: short, so a scenario need not wait the real one out. */
const SHORT_BLOCK_MS = 1500;

/** The navigator's idle time here. */
const SHORT_IDLE_MS = 300;

/** How often, and how many times, to look for a change. */
const POLL_MS = 20;
const POLLS = 500;

/** How long a save participant holds a batch's save open. */
const SAVE_HOLD_MS = 1500;

/** More changed lines than a report's diff shows (MAX_DIFF_LINES is 200). */
const LONG_EDIT_LINES = 250;

/** Text long enough to still be typing at speed 1 when the hand goes up. */
const LONG_TYPING = 'abcdefghijklmnopqrstuvwxyz'.repeat(2);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits for `done`, failing with `what` if it never holds. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < POLLS && !done(); i++) {
    await sleep(POLL_MS);
  }
  assert.ok(done(), `timed out waiting for ${what}`);
}

/** Calls `name` on the agent's relay and returns the text of its result. */
async function relayText(agent: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await agent.callTool({ name, arguments: args });
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const parts = result.content as Array<{ text: string }>;
  assert.ok(result.isError !== true, parts.map((part) => part.text).join('\n'));
  return parts.map((part) => part.text).join('\n\n');
}

/** Returns the extension host's environment, for a relay the test starts. */
function relayEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
}

/** Inserts text as the programmer would, retrying while the agent's own edit moves the document on. */
async function programmerTypes(document: vscode.TextDocument, position: vscode.Position, text: string): Promise<void> {
  for (let attempt = 0; attempt < POLLS; attempt++) {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, position, text);
    if (await vscode.workspace.applyEdit(edit)) {
      return;
    }
    await sleep(POLL_MS);
  }
  assert.fail("VS Code kept rejecting the programmer's edit");
}

/**
 * Plays the grant against observers that act inside it, through the extension's own controller class: the
 * controller's panel and diagnostic ports may call back into it, and a timer callback may already be queued
 * when its timer is cleared. The editor's own observers never do either, so a controller of this test's stands in.
 */
async function observerPaths(api: Api, root: string): Promise<void> {
  const LoadedController = z.custom<typeof Controller>((value) => typeof value === 'function').parse(api.controller.constructor);
  const posted: PanelEvent[] = [];
  const hooks: { post?: (event: PanelEvent) => void } = {};
  const controller = new LoadedController(api.editor, {
    post: (event) => {
      posted.push(event);
      hooks.post?.(event);
    },
  });
  controller.setTimeouts({ navigatorIdleMs: SHORT_IDLE_MS });
  /** Returns whether the floor was granted, or offered, since the last `start`. */
  function shown(event: PanelEvent): boolean {
    return posted.some((item) => JSON.stringify(item) === JSON.stringify(event));
  }
  const grantedEvent: PanelEvent = { type: 'attention', state: 'granted' };
  const offered: PanelEvent = { type: 'say', text: "What's up?" };
  try {
    // A diagnostic observer that ends the session as the hold is reported: nothing is granted to it.
    await controller.start('observer ends', root);
    posted.length = 0;
    controller.onDiagnostic = (event) => {
      if (event.kind === 'pause' && event.reasons.includes('attention')) {
        controller.disconnect();
        controller.endSession();
      }
    };
    controller.requestAttention();
    await sleep(POLL_MS);
    assert.ok(!shown(grantedEvent), 'a grant was published to a closed session');

    // A diagnostic observer that releases the hold as it is reported: the grant is not published.
    controller.onDiagnostic = undefined;
    await controller.start('observer releases', root);
    posted.length = 0;
    controller.onDiagnostic = (event) => {
      if (event.kind === 'pause' && event.reasons.includes('attention')) {
        controller.resume();
      }
    };
    controller.requestAttention();
    await sleep(POLL_MS);
    assert.equal(controller.isPaused, false);
    assert.ok(!shown(grantedEvent), 'a released grant was published');
    controller.onDiagnostic = undefined;

    // A panel that releases the floor as the grant is shown: the floor is not offered.
    posted.length = 0;
    hooks.post = (event) => {
      if (event.type === 'attention' && event.state === 'granted') {
        controller.resume();
      }
    };
    controller.requestAttention();
    await sleep(POLL_MS);
    assert.ok(shown(grantedEvent));
    assert.ok(!shown(offered), 'the floor was offered after its release');
    hooks.post = undefined;
    controller.endSession();
    console.log('Attention: observers that end or release the hold inside the grant fence what it publishes');

    // A navigator timer whose callback was already queued when the turn was handed back changes nothing
    // (specs/Navigator.tla, Fire).
    fs.writeFileSync(path.join(root, 'timer.txt'), 'a');
    await controller.start('queued timer', root);
    controller.takeTurn();
    await controller.listen();
    controller.userEdit(path.join(root, 'timer.txt'), 'a', 'ab', [{ offset: 1, deleteLength: 0, text: 'b' }]);
    const clear = globalThis.clearTimeout;
    globalThis.clearTimeout = (): void => {};
    try {
      controller.handBack();
    } finally {
      globalThis.clearTimeout = clear;
    }
    await controller.listen();
    await sleep(SHORT_IDLE_MS * 2);
    const next = controller.listen();
    controller.userMessage('Next.');
    assert.equal((await next).navigator?.wakeReason, undefined);
    console.log('Navigator: a timer already queued when the turn is handed back is ignored');
  } finally {
    controller.onDiagnostic = undefined;
    hooks.post = undefined;
    controller.endSession();
    controller.disconnect();
  }
}

/** Plays raising a hand, revealing the agent cursor, and changing the commentary preference. */
export async function attentionPaths(api: Api, root: string): Promise<void> {
  const { controller } = api;
  function file(name: string): string {
    return path.join(root, name);
  }
  /** Returns the state of the last attention update the panel was posted. */
  function attention(): string | undefined {
    const last = api.history().findLast((event) => event.type === 'attention');
    return last?.type === 'attention' ? last.state : undefined;
  }
  /** Calls `step` with nothing new until a batch reports, as an agent waiting on one does: the short wait here may end first. */
  async function settled(): Promise<Report> {
    let report = await controller.step([]);
    for (let attempt = 0; attempt < POLLS && report.batches.length === 0; attempt++) {
      report = await controller.step([]);
    }
    assert.ok(report.batches.length > 0, 'no batch reported');
    return report;
  }
  /** Returns whether the panel's last state update says speech is paused for a held floor. */
  function speechHeld(): boolean {
    const last = api.history().findLast((event) => event.type === 'state');
    return last?.type === 'state' && last.speechPaused !== undefined;
  }
  /** Opens `name` with `text` in an editor of its own and returns the document. */
  async function opened(name: string, text: string): Promise<vscode.TextDocument> {
    fs.writeFileSync(file(name), text);
    const document = await vscode.workspace.openTextDocument(file(name));
    await vscode.window.showTextDocument(document);
    return document;
  }
  controller.setTimeouts({ maxBlockMs: SHORT_BLOCK_MS, navigatorIdleMs: SHORT_IDLE_MS });
  const settings = vscode.workspace.getConfiguration('aiPair');
  const previousCommentary = settings.inspect('navigatorCommentary')?.globalValue;
  try {
    // With no session, a raised hand and a commentary change have nothing to act on, and the cursor nothing to reveal.
    controller.requestAttention();
    assert.equal(controller.isPaused, false);
    controller.setNavigatorCommentary('quiet');
    controller.setNavigatorCommentary('helpful');
    api.panelMessage({ type: 'revealCursor' });

    // A hand raised while the agent types is granted at the next action boundary, never inside an action: playback
    // holds, the agent is told why, and the floor is offered (specs/Attention.tla, Request, Drain, Grant).
    controller.setSpeed(1);
    const held = await opened('attention.txt', '\n');
    await controller.start('raised hand');
    await controller.read('attention.txt');
    await controller.step([
      { move: { file: 'attention.txt', line: 1, to: 'line_end' } },
      { type: `${LONG_TYPING}${CURSOR_MARKER}` },
      { type: `!${CURSOR_MARKER}` },
    ]);
    await until(() => held.getText().length > 1, 'the agent to start typing');
    api.panelMessage({ type: 'attention' });
    assert.equal(attention(), 'requested');
    await until(() => attention() === 'granted', 'the floor to be granted');
    assert.equal(held.getText(), `${LONG_TYPING}\n`, 'the hand was granted inside an action');
    assert.ok(
      api.history().some((event) => event.type === 'say' && event.text === "What's up?"),
      'the floor was not offered',
    );
    assert.ok(speechHeld(), 'the panel was not told speech is held');
    // A second click while the floor is held changes nothing.
    api.panelMessage({ type: 'attention' });
    assert.equal(attention(), 'granted');
    const holding = await controller.listen();
    assert.deepEqual(holding.paused, ['attention']);
    assert.equal(holding.waiting, true);
    // Resume releases the floor alone; a pause of the programmer's own outlasts it (specs/Attention.tla, Release).
    controller.pause();
    controller.resume();
    assert.equal(attention(), 'none');
    assert.equal(controller.isPaused, true);
    controller.resume();
    const released = await settled();
    assert.deepEqual(
      released.batches.map((batch) => batch.status),
      ['completed'],
    );
    assert.equal(held.getText(), `${LONG_TYPING}!\n`);
    console.log('Attention: a raised hand is granted at an action boundary, holds playback, and resume releases it');

    // The agent cursor is revealed from another file without changing the turn or what plays (specs/RevealCursor.tla).
    await opened('elsewhere.txt', 'elsewhere\n');
    api.panelMessage({ type: 'revealCursor' });
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file('attention.txt'), 'the agent cursor to be revealed');
    assert.equal(controller.turn, 'agent');
    // Looking away paused playback; revealing the cursor leaves that to the programmer's Resume.
    api.panelMessage({ type: 'resume' });
    console.log('RevealCursor: the agent cursor is shown without changing the turn');

    // A hand raised and lowered again before the boundary is never granted (specs/Attention.tla, Cancel).
    const retyped = await controller.step([
      { move: { file: 'attention.txt', line: 1, to: 'line_end' } },
      { type: `${LONG_TYPING}${CURSOR_MARKER}` },
    ]);
    assert.equal(retyped.rejected, undefined, JSON.stringify(retyped.rejected));
    await until(() => held.getText().length > LONG_TYPING.length + 2, 'the agent to type again');
    api.panelMessage({ type: 'attention' });
    api.panelMessage({ type: 'attention' });
    assert.equal(attention(), 'none');
    const unraised = await settled();
    assert.deepEqual(
      unraised.batches.map((batch) => batch.status),
      ['completed'],
    );
    assert.ok(unraised.paused === undefined, JSON.stringify(unraised.paused));

    // A hand raised while the batch's save is held open, after its last action, is granted once the batch is done.
    const raisedOnce = { done: false };
    const saving = vscode.workspace.onWillSaveTextDocument((event) => {
      if (!raisedOnce.done && event.document.uri.fsPath === file('attention.txt')) {
        raisedOnce.done = true;
        api.panelMessage({ type: 'attention' });
        event.waitUntil(sleep(SAVE_HOLD_MS));
      }
    });
    try {
      await controller.step([{ move: { file: 'attention.txt', line: 1, to: 'line_end' } }, { type: `.${CURSOR_MARKER}` }]);
      await until(() => attention() === 'granted', 'the floor to be granted after the save');
    } finally {
      saving.dispose();
    }
    // A message from the programmer takes the floor back.
    api.panelMessage({ type: 'reply', text: 'Never mind.' });
    assert.equal(attention(), 'none');
    await controller.end();
    console.log('Attention: a lowered hand is never granted; a hand raised during the last save is granted after it');

    // While nothing plays, the grant waits only for speech already under way. A hand lowered in the same moment it
    // went up, or a session ended then, is never granted; a hand raised again as the floor is released is granted
    // again (specs/Attention.tla, Cancel and Request).
    await controller.start('idle hands');
    api.panelMessage({ type: 'attention' });
    api.panelMessage({ type: 'attention' });
    await sleep(POLL_MS);
    assert.equal(attention(), 'none');
    assert.equal(controller.isPaused, false);
    api.panelMessage({ type: 'attention' });
    await until(() => attention() === 'granted', 'the idle floor to be granted');
    api.panelMessage({ type: 'resume' });
    api.panelMessage({ type: 'attention' });
    await until(() => attention() === 'granted', 'the floor to be granted again');
    api.panelMessage({ type: 'resume' });
    assert.equal(controller.isPaused, false);
    // The agent is gone, and the programmer raises a hand and ends the session at once.
    controller.disconnect();
    api.panelMessage({ type: 'attention' });
    controller.endSession();
    await sleep(POLL_MS);
    assert.equal(attention(), 'none');
    assert.equal(controller.turn, undefined);
    console.log('Attention: a hand lowered or a session ended before the grant is never granted; a raised-again hand is');

    // In the programmer's turn, a raised hand wakes the navigator's listen with the programmer's cursor, and a
    // report carrying it that the agent canceled comes back while the floor is still held (specs/Attention.tla,
    // Acknowledge and Restore).
    const typed = await opened('navigated.txt', 'one\n');
    const link = new EditorLink(root, discoveryDir());
    /** Calls `name` over the relay's link; the editor answers these tools with reports. */
    function relayed(name: 'start' | 'listen' | 'end', args: Record<string, unknown> = {}): Promise<Report> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return link.call(name, args) as Promise<Report>;
    }
    try {
      await relayed('start', { task: 'navigator hand', cwd: root });
      controller.takeTurn();
      await relayed('listen');
      // A typing pause the agent canceled after it returned comes back while no edit has followed it
      // (specs/Navigator.tla, Restore).
      await programmerTypes(typed, new vscode.Position(0, 0), '#');
      await sleep(SHORT_IDLE_MS * 2);
      const paused = await relayed('listen');
      assert.equal(paused.navigator?.wakeReason, 'typing_pause', JSON.stringify(paused));
      link.handBack(paused);
      const pausedAgain = await relayed('listen');
      assert.equal(pausedAgain.navigator?.wakeReason, 'typing_pause', JSON.stringify(pausedAgain));
      const waking = relayed('listen');
      await sleep(POLL_MS);
      api.panelMessage({ type: 'attention' });
      const raised = await waking;
      assert.equal(raised.navigator?.wakeReason, 'hand_raised', JSON.stringify(raised));
      assert.ok(raised.navigator.noticeId !== undefined);
      assert.equal(raised.navigator.programmerCursor?.file, 'navigated.txt');
      assert.equal(raised.navigator.programmerCursor.line, 1);
      assert.deepEqual(raised.paused, ['attention']);
      link.handBack(raised);
      const again = await relayed('listen');
      assert.equal(again.navigator?.wakeReason, 'hand_raised', JSON.stringify(again));
      assert.equal(again.repeated, true);
      // A commentary change while the floor is held says playback is held for it too.
      controller.setNavigatorCommentary('coach');
      const noticed = await relayed('listen');
      assert.ok(noticed.commentaryChanged !== undefined, JSON.stringify(noticed));
      assert.ok(noticed.paused?.includes('attention') === true, JSON.stringify(noticed.paused));
      controller.setNavigatorCommentary('helpful');
      await relayed('listen');
      // Once released, a canceled acknowledgement is not revived.
      controller.resume();
      link.handBack(raised);
      const quiet = await relayed('listen');
      assert.notEqual(quiet.navigator?.wakeReason, 'hand_raised', JSON.stringify(quiet));

      // With no file editor in front, the wake carries no programmer cursor.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'scratch' }));
      const cursorless = relayed('listen');
      await sleep(POLL_MS);
      api.panelMessage({ type: 'attention' });
      const noCursor = await cursorless;
      assert.equal(noCursor.navigator?.wakeReason, 'hand_raised', JSON.stringify(noCursor));
      assert.equal(noCursor.navigator.programmerCursor, undefined);
      controller.resume();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

      // The navigator's queued observation follows the programmer's edit while playback is paused, and a long
      // edit is reported with the lines its diff leaves out (specs/Rehearsal.tla, EditAsProgrammer).
      await vscode.window.showTextDocument(typed);
      controller.pause();
      const observed = controller.step([{ say: 'An observation.' }]);
      await sleep(POLL_MS);
      await programmerTypes(typed, new vscode.Position(0, 0), Array.from({ length: LONG_EDIT_LINES }, (_, i) => `line ${i}\n`).join(''));
      controller.resume();
      // The step's report or the next listen's takes the edit, whichever returns first.
      const events = [...(await observed).events, ...(await relayed('listen')).events];
      const edit = events.find((event) => event.kind === 'edit');
      assert.ok(edit?.kind === 'edit' && edit.omitted !== undefined, JSON.stringify(events));

      // A programmer who types and hands the turn straight back leaves the idle timer nothing to wake.
      await programmerTypes(typed, new vscode.Position(0, 0), 'x');
      api.panelMessage({ type: 'turn' });
      await sleep(SHORT_IDLE_MS * 2);
      assert.equal(controller.turn, 'agent');
      await relayed('end', {});
    } finally {
      link.close();
      await sleep(SHORT_IDLE_MS);
    }
    console.log('Attention, Navigator: a raised hand wakes listen with the cursor; a canceled acknowledgement is restored once');

    // The commentary preference, set in the panel, is saved in the settings and delivered to a waiting listen
    // alone, without consuming other evidence (specs/NavigatorCommentary.tla, SetMode and Notice).
    await settings.update('navigatorCommentary', undefined, vscode.ConfigurationTarget.Global);
    const commentaryLink = new EditorLink(root, discoveryDir());
    /** Calls `name` over the second link. */
    function linked(name: 'start' | 'listen' | 'end', args: Record<string, unknown> = {}): Promise<Report> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return commentaryLink.call(name, args) as Promise<Report>;
    }
    try {
      await linked('start', { task: 'commentary', cwd: root });
      controller.pause();
      const waiting = linked('listen');
      await sleep(POLL_MS);
      api.panelMessage({ type: 'navigatorCommentary', value: 'coach' });
      const changed = await waiting;
      assert.ok(changed.commentaryChanged !== undefined, JSON.stringify(changed));
      assert.deepEqual(changed.paused, ['programmer']);
      assert.equal(vscode.workspace.getConfiguration('aiPair').get('navigatorCommentary'), 'coach');
      controller.resume();
      // The same mode again is no change, and a value the panel can't send is ignored.
      controller.setNavigatorCommentary('coach');
      api.panelMessage({ type: 'navigatorCommentary', value: 'loud' });
      // A notice the agent canceled after it returned comes back while it is the newest (Restore)...
      commentaryLink.handBack(changed);
      const restored = await linked('listen');
      assert.ok(restored.commentaryChanged !== undefined, JSON.stringify(restored));
      // ...but not once a newer change has superseded it.
      controller.setNavigatorCommentary('quiet');
      const newer = await linked('listen');
      assert.ok(newer.commentaryChanged !== undefined, JSON.stringify(newer));
      commentaryLink.handBack(changed);
      const superseded = await linked('listen');
      assert.equal(superseded.commentaryChanged, undefined, JSON.stringify(superseded));
      // A session the agent dropped takes no notice; one it takes up again starts from the current mode.
      commentaryLink.close();
      await sleep(SHORT_IDLE_MS);
      controller.setNavigatorCommentary('helpful');
      const resumed = new EditorLink(root, discoveryDir());
      try {
        await resumed.call('start', { task: 'commentary', cwd: root });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const fresh = (await resumed.call('listen', {})) as Report;
        assert.equal(fresh.commentaryChanged, undefined, JSON.stringify(fresh));
        await resumed.call('end', {});
      } finally {
        resumed.close();
      }
    } finally {
      commentaryLink.close();
      await sleep(SHORT_IDLE_MS);
    }
    console.log('NavigatorCommentary: a change reaches a waiting listen once, and a canceled notice is restored only while newest');

    // A setting edited by hand to a value the panel can't send reads as the default, as the agent's next start says.
    controller.setNavigatorCommentary('quiet');
    await settings.update('navigatorCommentary', 'loud', vscode.ConfigurationTarget.Global);
    await until(() => vscode.workspace.getConfiguration('aiPair').get('navigatorCommentary') === 'loud', 'the hand-edited setting');
    // Through the relay, an agent reads the change, and a listen that times out in its own turn says so.
    const agent = new Client({ name: 'commentary-integration', version: '0' });
    await agent.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env: relayEnv() }));
    try {
      assert.match(await relayText(agent, 'start', { task: 'relay commentary' }), /Navigator commentary: Helpful:/);
      assert.match(await relayText(agent, 'listen'), /Nothing has happened yet\. Call `listen` again\./);
      const pending = relayText(agent, 'listen');
      await sleep(POLL_MS);
      controller.setNavigatorCommentary('coach');
      assert.match(await pending, /The navigator commentary preference changed\./);
      await relayText(agent, 'end');
    } finally {
      await agent.close();
    }
    console.log('NavigatorCommentary: a hand-edited setting reads as the default; the relay renders a change and an empty listen');

    await observerPaths(api, root);
  } finally {
    controller.setTimeouts({ maxBlockMs: defaultConfig.maxBlockMs, navigatorIdleMs: defaultConfig.navigatorIdleMs });
    await settings.update('navigatorCommentary', previousCommentary, vscode.ConfigurationTarget.Global);
  }
}
