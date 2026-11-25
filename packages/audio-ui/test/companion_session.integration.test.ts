import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import * as vscode from 'vscode';
import { ViewSlot } from '../src/view_slot';
import { createCompanionSession } from '../src/companion_session';

const fake = vi.hoisted(() => ({
  register: vi.fn(),
  execute: vi.fn<(command: string, frame: unknown) => Promise<unknown>>(),
  panel: undefined as unknown,
  stop: vi.fn(),
  speechCancel: vi.fn(),
  speechPause: vi.fn(),
  speechResume: vi.fn(),
  warning: vi.fn(),
  showSpeechTransport: vi.fn(),
  diagnostic: undefined as ((event: import('../../vscode/src/diagnostics').SpeechDiagnosticEvent) => void) | undefined,
}));
vi.mock('vscode', () => ({
  Uri: { file: (value: string) => ({ fsPath: value }), joinPath: (base: unknown) => base },
  commands: { executeCommand: fake.execute },
  window: {
    registerWebviewViewProvider: fake.register,
    showWarningMessage: fake.warning,
    createOutputChannel: () => ({ info: () => {}, dispose: () => {} }),
  },
}));
// The shortcut labels have their own tests; here the companion only needs a watcher to make and dispose.
vi.mock('../../vscode/src/shortcut_watcher', () => ({
  ShortcutWatcher: class {
    dispose = vi.fn();
  },
}));
vi.mock('../../audio-native/src/factory', () => ({ createLocalAudioAdapter: vi.fn(() => ({})) }));
vi.mock('../src/speech_host', () => ({
  createSpeechHost: vi.fn((options: { diagnostic: (event: import('../../vscode/src/diagnostics').SpeechDiagnosticEvent) => void }) => {
    fake.diagnostic = options.diagnostic;
    return {
      speech: { speak: () => Promise.resolve(), pause: fake.speechPause, resume: fake.speechResume, cancel: fake.speechCancel },
      output: { stopAndWait: fake.stop },
      panelSpeech: {},
      dispose: vi.fn(),
    };
  }),
}));
vi.mock('../../vscode/src/panel', () => ({
  NarrationPanel: class {
    static viewId = 'aiPair.narration';
    routing?: { forward(action: unknown, page: number): void; closed(page: number): void };
    useCompanion(routing: { forward(action: unknown, page: number): void; closed(page: number): void }) {
      this.routing = routing;
      fake.panel = this;
    }
    speechReadyPageId() {
      return 1;
    }
    showRemoteUpdate = vi.fn();
    showSpeechTransport = fake.showSpeechTransport;
    showFacepalmStatus = vi.fn();

    resolveWebviewView = vi.fn();
    release = vi.fn();
  },
}));

/** Narrows the fake panel routing without trusting an untyped callback. */
function isRouting(value: unknown): value is { forward(action: unknown, page: number): void; closed(page: number): void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'forward' in value &&
    typeof value.forward === 'function' &&
    'closed' in value &&
    typeof value.closed === 'function'
  );
}

describe('companion session integration', () => {
  it('forwards a deferred reply while resuming the locally paused narration', async () => {
    fake.stop.mockClear();
    fake.showSpeechTransport.mockClear();
    fake.speechCancel.mockClear();
    fake.speechResume.mockClear();
    fake.execute.mockClear().mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    const current = createCompanionSession(
      mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }),
      'epoch',
      new ViewSlot(),
    );
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel) || !isRouting(panel.routing)) throw new Error('No routing');
    panel.routing.forward({ type: 'draft', empty: false }, 1);
    panel.routing.forward({ type: 'reply', text: 'Wait', defer: true }, 1);
    expect(fake.speechCancel).not.toHaveBeenCalled();
    expect(fake.stop).not.toHaveBeenCalled();
    expect(fake.speechResume).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(fake.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'panelAction', action: { type: 'reply', text: 'Wait', defer: true } }),
      );
    });
    await current.dispose();
    expect(fake.showSpeechTransport).toHaveBeenCalledWith(false);
  });

  it('takes the view from the slot, registering no provider of its own, and forwards a reply only after local retirement', async () => {
    const retirement = Promise.withResolvers<void>();
    fake.stop.mockReturnValue(retirement.promise);
    fake.execute.mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    const context = mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] });
    const slot = new ViewSlot();
    const view = mock<vscode.WebviewView>();
    slot.resolveWebviewView(view);
    const session = createCompanionSession(context, 'epoch', slot);
    // The companion's one provider is the slot, registered by the extension; the session takes the open view (#127).
    expect(fake.register).not.toHaveBeenCalled();
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel)) throw new Error('No panel routing');
    if (!('resolveWebviewView' in panel) || typeof panel.resolveWebviewView !== 'function') throw new Error('No view handling');
    expect(panel.resolveWebviewView).toHaveBeenCalledWith(view);
    const routing: unknown = panel.routing;
    if (!isRouting(routing)) throw new Error('No forward');
    routing.forward({ type: 'reply', text: 'Hello.' }, 1);
    expect(fake.speechCancel).toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
    retirement.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.execute).toHaveBeenCalledTimes(1);
    fake.warning.mockClear();
    await session.dispose();
    expect(fake.warning).not.toHaveBeenCalled();
  });
  it('sends a replacement ready only after the old page stops and closes', async () => {
    const retirement = Promise.withResolvers<void>();
    fake.stop.mockReturnValue(retirement.promise);
    fake.execute.mockClear().mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    const context = mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] });
    const session = createCompanionSession(context, 'epoch', new ViewSlot());
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel)) throw new Error('No panel routing');
    const routing: unknown = panel.routing;
    if (!isRouting(routing)) throw new Error('No routing');
    routing.closed(1);
    routing.forward({ type: 'ready' }, 2);
    expect(fake.execute.mock.calls.map((call) => call[1])).toMatchObject([{ type: 'facepalmStatus' }]);
    retirement.resolve();
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(fake.execute.mock.calls.map((call) => call[1])).toMatchObject([
      { type: 'facepalmStatus' },
      { type: 'panelAction', pageEpoch: 1, action: { type: 'pageClosed' } },
      { type: 'panelAction', pageEpoch: 2, action: { type: 'ready' } },
    ]);
    await session.dispose();
  });
  it('clears an old page draft pause when the page is disposed', async () => {
    fake.stop.mockResolvedValue(undefined);
    fake.execute.mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    fake.speechPause.mockClear();
    fake.speechResume.mockClear();
    const session = createCompanionSession(
      mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }),
      'epoch',
      new ViewSlot(),
    );
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel)) throw new Error('No panel routing');
    if (!isRouting(panel.routing)) throw new Error('No routing');
    panel.routing.forward({ type: 'draft', empty: false }, 1);
    expect(fake.speechPause).toHaveBeenCalledTimes(1);
    panel.routing.closed(1);
    await Promise.resolve();
    expect(fake.speechResume).toHaveBeenCalledTimes(1);
    await session.dispose();
  });
  it('retains an independent manual pause when a draft page closes', async () => {
    fake.stop.mockResolvedValue(undefined);
    fake.execute.mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    fake.speechResume.mockClear();
    const session = createCompanionSession(
      mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }),
      'epoch',
      new ViewSlot(),
    );
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel)) throw new Error('No panel routing');
    if (!isRouting(panel.routing)) throw new Error('No routing');
    panel.routing.forward({ type: 'pause' }, 1);
    panel.routing.forward({ type: 'draft', empty: false }, 1);
    panel.routing.closed(1);
    await Promise.resolve();
    expect(fake.speechResume).not.toHaveBeenCalled();
    panel.routing.forward({ type: 'resume' }, 2);
    expect(fake.speechResume).toHaveBeenCalledTimes(1);
    await session.dispose();
  });
  it('retains only sanitized local speech diagnostics and real build identity', async () => {
    fake.stop.mockResolvedValue(undefined);
    fake.execute.mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    const session = createCompanionSession(
      mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }),
      'epoch',
      new ViewSlot(),
    );
    fake.diagnostic?.({ kind: 'speech', event: 'preview', phase: 'ready', provider: 'kokoro' });
    expect(session.diagnostics()).toMatchObject({ version: 'test', build: 'test-build', events: [{ kind: 'speech', event: 'preview' }] });
    await session.dispose();
  });
  it('clears local pause reasons after canceling for a reply and when explicitly resumed', async () => {
    fake.stop.mockResolvedValue(undefined);
    fake.execute.mockResolvedValue(undefined);
    fake.register.mockReturnValue({ dispose: () => {} });
    fake.speechCancel.mockClear();
    fake.speechResume.mockClear();
    const session = createCompanionSession(
      mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }),
      'epoch',
      new ViewSlot(),
    );
    const panel = fake.panel;
    if (typeof panel !== 'object' || panel === null || !('routing' in panel)) throw new Error('No panel routing');
    if (!isRouting(panel.routing)) throw new Error('No routing');
    panel.routing.forward({ type: 'draft', empty: false }, 1);
    panel.routing.forward({ type: 'reply', text: 'Continue.' }, 1);
    expect(fake.speechCancel).toHaveBeenCalledTimes(1);
    expect(fake.speechResume).toHaveBeenCalledTimes(1);
    expect(fake.speechCancel.mock.invocationCallOrder[0]).toBeLessThan(fake.speechResume.mock.invocationCallOrder[0] ?? 0);
    await Promise.resolve();
    panel.routing.forward({ type: 'draft', empty: false }, 1);
    panel.routing.forward({ type: 'resume' }, 1);
    expect(fake.speechResume).toHaveBeenCalledTimes(2);
    await session.dispose();
  });
});
