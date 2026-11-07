import { describe, expect, it } from 'vitest';
import { localPanelUpdate } from '../src/panel_update';

describe('cross-host panel updates', () => {
  it('accepts the visible session, replay, and workspace UI updates', () => {
    for (const update of [
      { type: 'say', text: 'Hello.' },
      { type: 'replay', events: [{ type: 'session', active: true, task: 'Pair' }] },
      { type: 'selection', ref: { file: 'a.ts', line: 1, endLine: 2 } },
      { type: 'focusReply' },
      { type: 'calibration', view: { phase: 'idle' } },
    ]) {
      expect(localPanelUpdate.safeParse(update).success).toBe(true);
    }
  });

  it('rejects audio, speech settings, arbitrary commands, and unexpected properties', () => {
    for (const update of [
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
