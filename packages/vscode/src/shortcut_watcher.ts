// Reads the programmer's keybindings.json for the panel's tooltips: once as the extension starts, and again each
// time the file changes (#94; specs/Shortcuts.tla). VS Code has no API that reports a command's keybinding.

import * as vscode from 'vscode';
import { parse } from 'jsonc-parser';
import type { ShortcutLabels } from '@ai-pair/protocol';
import { shortcutLabels, type ShortcutPlatform } from './shortcut_labels';

/** The file in VS Code's `User` folder that holds the programmer's keybindings. */
const KEYBINDINGS_FILE = 'keybindings.json';

/** Watches keybindings.json, and hands the labels of the latest read to `show`. */
export class ShortcutWatcher implements vscode.Disposable {
  /** Reads started so far; the latest read's number. */
  private started = 0;
  private readonly watcher: vscode.FileSystemWatcher;

  /**
   * Starts watching `userDirectory`'s keybindings.json, and reads it once (specs/Shortcuts.tla, `Init`).
   * `show` gets the labels for `platform` each time a read lands that no later one overtook.
   */
  constructor(
    private readonly userDirectory: vscode.Uri,
    private readonly platform: ShortcutPlatform,
    private readonly show: (labels: ShortcutLabels) => void,
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(userDirectory, KEYBINDINGS_FILE));
    // specs/Shortcuts.tla, `Edit`: each change to the file starts a read.
    const read = (): void => {
      this.read();
    };
    this.watcher.onDidChange(read);
    this.watcher.onDidCreate(read);
    this.watcher.onDidDelete(read);
    this.read();
  }

  /** Reads the file, numbered; a file that cannot be read reads as empty, which leaves the defaults. */
  private read(): void {
    const number = ++this.started;
    void Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.userDirectory, KEYBINDINGS_FILE)))
      .then(
        (bytes) => new TextDecoder().decode(bytes),
        () => '',
      )
      .then((text) => {
        // specs/Shortcuts.tla, `Land`: a read that a later one overtook is dropped.
        if (number !== this.started) return;
        const file: unknown = parse(text);
        this.show(shortcutLabels(file, this.platform));
      });
  }

  /** Stops watching the file. */
  dispose(): void {
    this.watcher.dispose();
  }
}
