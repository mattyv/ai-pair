// Registers before AI Pair activates, so the test observes a real terminal close before Pair forgets it.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

const RUN_ID = 900_001;
const TIMEOUT_MS = 15_000;

/** The close observer must be installed before the extension creates its own listener. */
export function installTerminalCleanup(): { run(api: Api): Promise<void>; dispose(): void } {
  let armed: { terminal: vscode.Terminal; api: Api; done: (result: { exited: boolean; removed: boolean }) => void } | undefined;
  const listener = vscode.window.onDidCloseTerminal((terminal) => {
    if (armed?.terminal !== terminal) return;
    const current = armed;
    armed = undefined;
    const exited = terminal.exitStatus !== undefined;
    current.api.editor.cleanupIdleTerminals();
    current.done({ exited, removed: !current.api.editor.showTerminal(RUN_ID) });
  });
  return {
    async run(api) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(folder, 'the cleanup test needs a workspace');
      const directory = fs.mkdtempSync(path.join(folder.uri.fsPath, '.terminal-cleanup-'));
      const settings = vscode.workspace.getConfiguration('aiPair');
      const global = vscode.ConfigurationTarget.Global;
      const previous = settings.inspect<boolean>('showTerminalsAutomatically')?.globalValue;
      const before = new Set(vscode.window.terminals);
      let terminal: vscode.Terminal | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await settings.update('showTerminalsAutomatically', false, global);
        const outcome = await api.editor.runCommand('printf ai-pair-cleanup-idle', {
          id: RUN_ID,
          cwd: directory,
          waitMs: TIMEOUT_MS,
          signal: new AbortController().signal,
        });
        assert.equal(outcome.exitCode, 0, 'the real shell command did not finish successfully');
        assert.ok(outcome.output.includes('ai-pair-cleanup-idle'), 'the command output was not captured');
        const created = vscode.window.terminals.find((item) => !before.has(item));
        assert.ok(created, 'the command did not create its own terminal');
        terminal = created;
        const closed = new Promise<{ exited: boolean; removed: boolean }>((resolve) => {
          armed = { terminal: created, api, done: resolve };
        });
        terminal.dispose();
        const result = await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error('The idle terminal did not close'));
            }, TIMEOUT_MS);
          }),
        ]);
        assert.equal(result.exited, true, 'the close observer did not see a real exit status');
        assert.equal(result.removed, true, 'cleanup did not retire the exited hidden terminal before the Pair close listener');
        console.log('an exited idle hidden terminal is removed by the earlier close observer');
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        armed = undefined;
        terminal?.dispose();
        await settings.update('showTerminalsAutomatically', previous, global);
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    dispose() {
      listener.dispose();
    },
  };
}
