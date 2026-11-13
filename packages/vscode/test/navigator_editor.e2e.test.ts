// Composed native VS Code change event through the real editor adapter and controller to a Navigator report.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '@ai-pair/core';
import { FakePanel, testConfig, until } from '../../core/test/fake';
import { VsCodeEditor } from '../src/editor';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** Each event's listeners, by the event's name. */
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  /** Returns an event's registration: it adds the listener, and its disposable takes it away. */
  function event(name: string): (listener: (value: unknown) => void) => { dispose: () => void } {
    return (listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return {
        dispose: () => {
          set.delete(listener);
        },
      };
    };
  }

  /** What the fakes made. */
  const created = {
    types: [] as FakeDecorationType[],
    edits: [] as FakeWorkspaceEdit[],
    terminals: [] as FakeTerminals[],
    /** The documents openTextDocument opened. */
    opened: [] as FakeDocument[],
  };

  /** The files on disk, by path. */
  const onDisk = new Set<string>();

  /** A position in a fake document: an offset is its line, so a test reads lines straight off offsets. */
  interface FakePosition {
    line: number;
    character: number;
  }

  /** A visible range, by its lines. */
  interface FakeLines {
    start: { line: number };
    end: { line: number };
  }

  /** A range as editor.ts makes one: the arguments it was made with. */
  class FakeRange {
    readonly args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
    }
  }

  /** A document, faked: its path and scheme, its text, whether it is dirty, and how its save goes. */
  class FakeDocument {
    isDirty = false;
    /** VS Code's EndOfLine: 1 is LF, 2 is CRLF, as the fake module has them. */
    eol = 1;
    lineCount = 1000;
    /** What `getText` gives for a range: the programmer's selection. */
    selected = '';
    readonly uri: { scheme: string; fsPath: string };
    readonly save = vi.fn(() => Promise.resolve(true));

    constructor(
      fsPath: string,
      public text = '',
      scheme = 'file',
    ) {
      this.uri = { scheme, fsPath };
    }

    getText(range?: unknown): string {
      return range === undefined ? this.text : this.selected;
    }

    positionAt(offset: number): FakePosition {
      return { line: offset, character: 0 };
    }
  }

  /** The builder an editor's `edit` hands its callback. */
  interface FakeBuilder {
    replace: (range: FakeRange, text: string) => void;
  }

  /** A text editor, faked: its document, selection, visible ranges, and what it was asked to draw, edit, and reveal. */
  class FakeEditor {
    selection: { start: FakePosition; end: FakePosition; active?: FakePosition; isEmpty: boolean } = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      isEmpty: true,
    };
    visibleRanges: FakeLines[] = [];
    viewColumn: number | undefined = 1;
    /** Whether VS Code applies an edit. */
    applies = true;
    readonly builder = { replace: vi.fn<(range: FakeRange, text: string) => void>() };
    readonly setDecorations = vi.fn<(type: FakeDecorationType, ranges: FakeRange[]) => void>();
    readonly revealRange = vi.fn<(range: FakeRange, type: number) => void>();
    readonly edit = vi.fn<(build: (builder: FakeBuilder) => void, options: unknown) => Promise<boolean>>((build) => {
      build(this.builder);
      return Promise.resolve(this.applies);
    });

    constructor(readonly document: FakeDocument) {}
  }

  /** A decoration type, faked: the options it was made with, and its disposal. */
  class FakeDecorationType {
    readonly dispose = vi.fn();

    constructor(
      readonly options: {
        before?: { contentText: string; textDecoration: string };
        backgroundColor?: { id: string };
      },
    ) {}
  }

  /** A workspace edit, faked: its replacements. */
  class FakeWorkspaceEdit {
    readonly replace = vi.fn<(uri: unknown, range: FakeRange, text: string) => void>();

    constructor() {
      created.edits.push(this);
    }
  }

  /** The agent's terminals, faked: what `run` answers, and their disposal. */
  class FakeTerminals {
    readonly run = vi.fn((command: string) => Promise.resolve({ output: `ran ${command}` }));
    readonly dispose = vi.fn();
    readonly showTerminal = vi.fn<(id: number) => boolean>(() => true);
    readonly cleanupIdle = vi.fn();

    constructor(readonly showAutomatically: () => boolean) {
      created.terminals.push(this);
    }
  }

  return {
    listeners,
    event,
    FakeRange,
    FakeDocument,
    FakeEditor,
    FakeDecorationType,
    FakeWorkspaceEdit,
    FakeTerminals,
    created,
    onDisk,
    /** VS Code's TextEditorRevealType, as the fake module has it. */
    reveal: { InCenter: 2, AtTop: 3 },
    /** VS Code's open documents. */
    documents: [] as FakeDocument[],
    /** VS Code's visible editors, and its active one. */
    visible: [] as FakeEditor[],
    active: undefined as FakeEditor | undefined,
    /** The workspace's folders; none until a test says. */
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    /** The `editor` settings, by name. */
    settings: new Map<string, unknown>(),
    stat: vi.fn((uri: { fsPath: string }) =>
      onDisk.has(uri.fsPath) ? Promise.resolve({}) : Promise.reject(new Error(`ENOENT: ${uri.fsPath}`)),
    ),
    createDirectory: vi.fn((uri: { fsPath: string }) => Promise.resolve(uri)),
    writeFile: vi.fn((uri: { fsPath: string }, content: Uint8Array) => Promise.resolve({ uri, content })),
    openTextDocument: vi.fn((uri: { fsPath: string }) => {
      const doc = new FakeDocument(uri.fsPath, 'opened');
      created.opened.push(doc);
      return Promise.resolve(doc);
    }),
    applyEdit: vi.fn((edit: FakeWorkspaceEdit) => Promise.resolve(edit.replace.mock.calls.length > 0)),
    showTextDocument: vi.fn<(doc: FakeDocument, options: unknown) => Promise<FakeEditor | void>>(() => Promise.resolve()),
    showErrorMessage: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
    diagnostics:
      vi.fn<
        () => Array<{ severity: number; message: string; source?: string; range: { start: { line: number }; end: { line: number } } }>
      >(),
  };
});

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  Range: fakes.FakeRange,
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  WorkspaceEdit: fakes.FakeWorkspaceEdit,
  DecorationRangeBehavior: { ClosedClosed: 1 },
  EndOfLine: { LF: 1, CRLF: 2 },
  TextEditorRevealType: fakes.reveal,
  DiagnosticSeverity: { Error: 0 },
  languages: { getDiagnostics: fakes.diagnostics },
  window: {
    createTextEditorDecorationType: (options: InstanceType<typeof fakes.FakeDecorationType>['options']) => {
      const type = new fakes.FakeDecorationType(options);
      fakes.created.types.push(type);
      return type;
    },
    get activeTextEditor() {
      return fakes.active;
    },
    get visibleTextEditors() {
      return fakes.visible;
    },
    showTextDocument: fakes.showTextDocument,
    showErrorMessage: fakes.showErrorMessage,
    onDidChangeActiveTextEditor: fakes.event('active'),
    onDidChangeTextEditorVisibleRanges: fakes.event('visibleRanges'),
    onDidChangeVisibleTextEditors: fakes.event('visibleEditors'),
    onDidChangeTextEditorSelection: fakes.event('selection'),
  },
  workspace: {
    get textDocuments() {
      return fakes.documents;
    },
    get workspaceFolders() {
      return fakes.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (fakes.settings.has(key) ? fakes.settings.get(key) : fallback),
    }),
    openTextDocument: fakes.openTextDocument,
    applyEdit: fakes.applyEdit,
    fs: { stat: fakes.stat, createDirectory: fakes.createDirectory, writeFile: fakes.writeFile },
    onDidOpenTextDocument: fakes.event('open'),
    onDidCloseTextDocument: fakes.event('close'),
    onDidChangeTextDocument: fakes.event('change'),
  },
}));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../src/terminal', () => ({ PairTerminals: fakes.FakeTerminals }));
vi.mock('../src/python_diagnostics', () => ({ pythonDiagnostic: vi.fn() }));

const FILE = '/tmp/pair-example.cpp';

afterEach(() => {
  vi.useRealTimers();
  fakes.documents.length = 0;
  fakes.visible.length = 0;
  fakes.active = undefined;
  fakes.onDisk.clear();
  fakes.listeners.clear();
});

describe('native editor events and Navigator', () => {
  it('wakes on quiet unsaved edits in the current outside cursor file', async () => {
    vi.useFakeTimers();
    const doc = new fakes.FakeDocument(FILE, '');
    const view = new fakes.FakeEditor(doc);
    view.selection.active = { line: 0, character: 0 };
    fakes.documents.push(doc);
    fakes.visible.push(view);
    fakes.active = view;
    fakes.onDisk.add(FILE);
    let controller: Controller;
    const editor = new VsCodeEditor(
      '/project',
      'Agent',
      () => controller,
      () => false,
    );
    controller = new Controller(editor, new FakePanel(), { ...testConfig, navigatorIdleMs: 3000 });
    try {
      await controller.start();
      await until(controller.step([{ move: { file: FILE, line: 1, to: 'line_end' } }]));
      await vi.advanceTimersByTimeAsync(1000);
      controller.takeTurn();
      await until(controller.listen());
      const listening = controller.listen();
      let settled = false;
      void listening.then(() => {
        settled = true;
      });
      doc.isDirty = true;
      doc.text = 'hello';
      view.selection.active = { line: 0, character: 5 };
      for (const listener of fakes.listeners.get('change') ?? []) {
        listener({ document: doc, contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: 'hello' }] });
      }
      await vi.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const report = await listening;
      expect(report.navigator).toMatchObject({ wakeReason: 'typing_pause', programmerCursor: { file: FILE, line: 1, column: 6 } });
      expect(report.events).toEqual([
        { kind: 'edit', file: FILE, by: 'programmer', diff: '@@ -0,0 +1,1 @@\n+1: hello\n\\ No newline at end of file' },
      ]);
    } finally {
      controller.endSession();
      editor.dispose();
    }
  });
});
