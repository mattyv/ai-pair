import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { mock } from 'vitest-mock-extended';
import { ViewSlot, type SlotPanel } from '../src/view_slot';

/** A panel that records the views it is given and when it lets go. */
function panel(): SlotPanel & { resolveWebviewView: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  return { resolveWebviewView: vi.fn<(view: vscode.WebviewView) => void>(), release: vi.fn<() => void>() };
}

describe('the companion view slot (#127)', () => {
  it('CompanionCommit: gives the open view to the panel attached, and to each panel that replaces it', () => {
    const slot = new ViewSlot();
    const first = panel();
    slot.attach(first);
    expect(first.resolveWebviewView).not.toHaveBeenCalled();
    const view = mock<vscode.WebviewView>();
    slot.resolveWebviewView(view);
    expect(first.resolveWebviewView).toHaveBeenCalledExactlyOnceWith(view);
    const second = panel();
    slot.attach(second);
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.resolveWebviewView).toHaveBeenCalledExactlyOnceWith(view);
  });

  it('keeps a view resolved before any panel, for the first to attach', () => {
    const slot = new ViewSlot();
    const view = mock<vscode.WebviewView>();
    slot.resolveWebviewView(view);
    const first = panel();
    slot.attach(first);
    expect(first.resolveWebviewView).toHaveBeenCalledExactlyOnceWith(view);
  });

  it('NoDeadView: forgets a view the programmer closed, and hands the next panel the one opened after it (#127 review)', () => {
    const slot = new ViewSlot();
    const closed = mock<vscode.WebviewView>();
    slot.resolveWebviewView(closed);
    const [closeView] = closed.onDidDispose.mock.lastCall ?? [];
    if (closeView === undefined) throw new Error('The slot did not watch its view.');
    const reopened = mock<vscode.WebviewView>();
    slot.resolveWebviewView(reopened);
    // The earlier view's disposal, arriving late, leaves the newer one alone.
    closeView();
    const first = panel();
    slot.attach(first);
    expect(first.resolveWebviewView).toHaveBeenCalledExactlyOnceWith(reopened);
    const [closeReopened] = reopened.onDidDispose.mock.lastCall ?? [];
    closeReopened?.();
    const second = panel();
    slot.attach(second);
    expect(second.resolveWebviewView).not.toHaveBeenCalled();
  });

  it('lets go of a detached panel, and ignores one that is no longer current', () => {
    const slot = new ViewSlot();
    const first = panel();
    const second = panel();
    slot.attach(first);
    slot.attach(second);
    first.release.mockClear();
    slot.detach(first);
    expect(first.release).not.toHaveBeenCalled();
    slot.detach(second);
    expect(second.release).toHaveBeenCalledOnce();
    const view = mock<vscode.WebviewView>();
    slot.resolveWebviewView(view);
    expect(second.resolveWebviewView).not.toHaveBeenCalled();
  });
});
