import { describe, expect, it } from 'vitest';
import { localPanelUpdate } from '../src/panel_update';

describe('cross-host panel updates', () => {
  it('accepts the visible session, replay, and workspace UI updates', () => {
    for (const update of [
      { type: 'say', text: 'Hello.' },
      { type: 'replay', events: [{ type: 'session', active: true, task: 'Pair' }] },
      { type: 'selection', ref: { file: 'a.ts', line: 1, endLine: 2 } },
      { type: 'focusReply' },
      { type: 'replyBehavior', value: 'interrupt' },
      { type: 'replyBehavior', value: 'finishAction' },
      { type: 'commandApprovalSound', value: true },
      { type: 'commandApprovals', all: true, count: 2, confirmationRequired: true },
      { type: 'commandApprovalSound', value: false },
      { type: 'session', active: true, costSessionGeneration: 1 },
      { type: 'replay', events: [], costSessionGeneration: 1, costSessionActive: true },
      { type: 'calibration', view: { phase: 'idle' } },
    ]) {
      expect(localPanelUpdate.safeParse(update).success).toBe(true);
    }
  });

  it('rejects audio, speech settings, arbitrary commands, and unexpected properties', () => {
    for (const update of [
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
});
