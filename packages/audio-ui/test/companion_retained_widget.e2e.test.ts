import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';
import { createCompanionSession } from '../src/companion_session';
import type { NarrationPanel } from '../../vscode/src/panel';

const fake = vi.hoisted(() => ({ panel: undefined as NarrationPanel | undefined }));
vi.mock('vscode', () => ({
  Uri: { joinPath: () => ({ toString: () => 'resource' }), file: () => ({ fsPath: '/test' }) },
  commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
  window: {
    registerWebviewViewProvider: (id: string, panel: NarrationPanel) => {
      void id;
      fake.panel = panel;
      return { dispose() {} };
    },
    showWarningMessage: vi.fn(),
    createOutputChannel: () => ({ info() {}, dispose() {} }),
  },
}));
vi.mock('../../vscode/src/shortcut_watcher', () => ({
  ShortcutWatcher: class {
    dispose() {}
  },
}));
vi.mock('../../audio-native/src/factory', () => ({ createLocalAudioAdapter: vi.fn(() => ({})) }));
vi.mock('../src/speech_host', () => ({
  createSpeechHost: () => ({
    speech: { speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() },
    output: { stopAndWait: vi.fn().mockResolvedValue(undefined) },
    panelSpeech: {},
    dispose: vi.fn(),
  }),
}));
vi.mock('../../vscode/src/facepalm_client', () => ({
  FacepalmClient: class {
    status: 'connected' | 'unchecked' = 'connected';
    onStatus?: () => void;
    snapshot() {
      return { enabled: true, status: this.status, available: true, canOpenSettings: true };
    }
    dispose() {
      this.status = 'unchecked';
      return Promise.resolve();
    }
    retire() {
      this.status = 'unchecked';
    }
    refresh() {
      return Promise.resolve();
    }
    setEnabled() {}
  },
}));

it('updates the retained rendered page after companion shutdown loses its channel', async () => {
  const window = new Window();
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLDetailsElement',
    'HTMLAnchorElement',
    'HTMLAudioElement',
    'HTMLDialogElement',
    'HTMLLabelElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
  ]) {
    vi.stubGlobal(key, key === 'window' ? window : key === 'document' ? window.document : Reflect.get(window, key));
  }
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    },
  );
  vi.useFakeTimers();
  const current = createCompanionSession(mock<vscode.ExtensionContext>({ extensionPath: '/test', subscriptions: [] }), 'epoch');
  try {
    const { loadPage } = await import('../../vscode/test/page');
    await loadPage();
    const panel = fake.panel;
    if (panel === undefined) throw new Error('Missing panel');
    const webview = mock<vscode.Webview>({
      cspSource: 'test',
      asWebviewUri: () => mock<vscode.Uri>({ toString: () => 'resource' }),
      postMessage: (message) => {
        window.dispatchEvent(new window.MessageEvent('message', { data: message }));
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({ dispose() {} }),
    });
    panel.resolveWebviewView(mock<vscode.WebviewView>({ webview, onDidDispose: () => ({ dispose() {} }) }));
    panel.showFacepalmStatus({ enabled: true, status: 'connected', available: true, canOpenSettings: true });
    const status = window.document.querySelector('[data-ui="facepalm-status"]');
    expect(status?.textContent).toContain('Connected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status?.textContent).not.toContain('Connected');
    expect(status?.textContent).toContain('Unchecked');
  } finally {
    await current.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await window.happyDOM.abort();
  }
});
