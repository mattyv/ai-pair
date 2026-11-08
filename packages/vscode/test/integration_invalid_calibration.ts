// User timing settings must not prevent calibration from saving.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

const storedTiming = z.object({ reading: z.object({ msPerChar: z.number().nonnegative() }) });

/** Calibrates after malformed and existing valid settings, then restores the user's setting. */
export async function invalidCalibration(api: Api): Promise<void> {
  const settings = vscode.workspace.getConfiguration('aiPair');
  const previous = settings.inspect<unknown>('timing')?.globalValue;
  const global = vscode.ConfigurationTarget.Global;
  try {
    for (const malformed of [42, { reading: 42 }, { reading: { msPerChar: 77 } }]) {
      await settings.update('timing', malformed, global);
      assert.deepEqual(vscode.workspace.getConfiguration('aiPair').get('timing'), malformed);
      await vscode.commands.executeCommand('aiPair.calibrate');
      api.panelMessage({ type: 'reply', text: 'go' });
      api.panelMessage({ type: 'reply', text: 'x' });
      let saved = false;
      for (let attempt = 0; attempt < 100 && !saved; attempt++) {
        const current = storedTiming.safeParse(vscode.workspace.getConfiguration('aiPair').get('timing'));
        saved = current.success && current.data.reading.msPerChar !== 77 && !api.controller.isPaused;
        if (!saved) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          });
        }
      }
      assert.ok(saved, 'calibration did not save a valid reading rate');
      assert.equal(api.controller.isPaused, false, 'calibration left playback paused');
    }
  } finally {
    await settings.update('timing', previous, global);
  }
  console.log('calibration recovers from malformed settings and updates an existing reading rate');
}
