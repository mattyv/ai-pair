import type * as vscode from 'vscode';

/** What the slot needs of a panel: to be given the view, and to let go of it. */
export interface SlotPanel {
  resolveWebviewView(view: vscode.WebviewView): void;
  release(): void;
}

/**
 * The companion's one Pair view provider, kept for as long as the companion runs, which hands the view to the current
 * session's panel (#127). VS Code does not give a view already open to a provider registered later, so a session that
 * replaces another after a reconnect takes the open view from this slot instead of registering a provider of its own
 * (specs/LocalAudioReconnect.tla, Attach and SingleProvider).
 */
export class ViewSlot implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private current?: SlotPanel;

  /** Keeps the view VS Code resolves, and gives it to the current panel. */
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.current?.resolveWebviewView(view);
  }

  /** Makes `panel` the view's owner: the previous one lets go, and the new one takes the open view, if any. */
  attach(panel: SlotPanel): void {
    this.current?.release();
    this.current = panel;
    if (this.view !== undefined) panel.resolveWebviewView(this.view);
  }

  /** Lets go of `panel`, if it still owns the view. */
  detach(panel: SlotPanel): void {
    if (this.current !== panel) return;
    panel.release();
    this.current = undefined;
  }
}
