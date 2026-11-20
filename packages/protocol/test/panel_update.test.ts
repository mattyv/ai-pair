import { describe, expect, it } from 'vitest';
import { localPanelUpdate } from '../src/panel_update';

describe('cross-host panel updates', () => {
  it('accepts the visible session, replay, and workspace UI updates', () => {
    for (const update of [
      { type: 'say', text: 'Hello.' },
      { type: 'attention', state: 'granted' },
      { type: 'state', state: 'paused', turn: 'agent', paused: true, speechPaused: false },
      { type: 'replay', events: [{ type: 'session', active: true, task: 'Pair' }] },
      { type: 'selection', ref: { file: 'a.ts', line: 1, endLine: 2 } },
      { type: 'focusReply' },
      { type: 'navigatorCommentary', value: 'quiet' },
      { type: 'navigatorCommentary', value: 'helpful' },
      { type: 'navigatorCommentary', value: 'coach' },
      { type: 'replyBehavior', value: 'interrupt' },
      { type: 'replyBehavior', value: 'finishAction' },
      { type: 'commandApprovalSound', value: true },
      { type: 'commandApprovals', all: true, count: 2, confirmationRequired: true },
      { type: 'commandApprovalSound', value: false },
      { type: 'session', active: true, costSessionGeneration: 1 },
      { type: 'replay', events: [], costSessionGeneration: 1, costSessionActive: true },
      { type: 'calibration', view: { phase: 'idle' } },
      { type: 'programmer', text: 'Hi.', receipt: 1 },
      { type: 'turn', to: 'agent', message: 'Yours.', receipt: 2 },
      { type: 'receipt', ids: [1, 2], received: true },
    ]) {
      expect(localPanelUpdate.safeParse(update).success).toBe(true);
    }
  });

  it('rejects audio, speech settings, arbitrary commands, and unexpected properties', () => {
    for (const update of [
      { type: 'attention', state: 'invalid' },
      { type: 'state', state: 'paused', turn: 'agent', paused: true, speechPaused: 'false' },
      { type: 'navigatorCommentary', value: 'invalid' },
      { type: 'navigatorCommentary', value: 'coach', extra: true },
      { type: 'replyBehavior', value: 'invalid' },
      { type: 'replyBehavior', value: 'finishAction', extra: true },
      { type: 'commandApprovalSound', value: 'true' },
      { type: 'session', active: true, costSessionGeneration: 0 },
      { type: 'replay', events: [], costSessionGeneration: 1 },
      { type: 'speechAudio', wavBase64: 'abc' },
      { type: 'speechSettings', value: { key: 'secret' } },
      { type: 'command', command: 'arbitrary' },
      { type: 'say', text: 'Hello', secret: 'key' },
      { type: 'replay', events: [{ type: 'speechAudio', wavBase64: 'abc' }] },
    ]) {
      expect(localPanelUpdate.safeParse(update).success).toBe(false);
    }
  });

  it('bounds the receipts one update carries (#117)', () => {
    expect(localPanelUpdate.safeParse({ type: 'receipt', ids: Array.from({ length: 10_001 }, (_, i) => i), received: true }).success).toBe(
      false,
    );
    expect(localPanelUpdate.safeParse({ type: 'receipt', ids: [1], received: 'yes' }).success).toBe(false);
  });
});

it('accepts bounded worker activity and visibility updates', () => {
  expect(localPanelUpdate.safeParse({ type: 'workerActivity', id: 1, phase: 'progress', text: 'Checking.' }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerVisibility', value: 'everything' }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerActive', id: 1 }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerActive' }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerActivity', id: 0, phase: 'progress', text: 'Checking.' }).success).toBe(false);
});

it('validates worker settings at the panel boundary', () => {
  expect(localPanelUpdate.safeParse({ type: 'workerEnabled', value: false }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerModel', value: '' }).success).toBe(true);
  expect(localPanelUpdate.safeParse({ type: 'workerModel', value: 'x'.repeat(257) }).success).toBe(false);
  expect(localPanelUpdate.safeParse({ type: 'workerEnabled', value: 'false' }).success).toBe(false);
});
