// The extension's wiring on its own (#176): what activate makes, the commands and settings it registers, and the
// Api it hands the integration test. Solitary: vscode, node:os, core's Bridge and Controller, and every module of
// the extension it builds on are fakes, so a test says what each answers and sees what activate asked of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { isSavedSession } from '@ai-pair/core';
import { playDemo } from '../src/demo';
import { activate, deactivate } from '../src/extension';
import { setTimings } from '../src/timings';
import { watchOutside } from '../src/outside_watch';
import { settingSpeed } from '../src/panel_html';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import type { SpeechOutput } from '../src/speech_service';
import type { PanelWiring } from '../src/panel';
import type { CatalogView } from '../src/speech_catalog';
import type { SpeechSettings } from '../src/speech_types';
import { installedSpeechModel, setupSpeech } from '../src/speech_setup';
import { builtInPassage } from '../src/passage';
import { claudeStarter, setUpAgent, writeLauncher } from '../src/setup';

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

  /** What was made, and what the fakes answer. */
  const made = {
    controllers: [] as Array<InstanceType<typeof FakeController>>,
    bridges: [] as Array<InstanceType<typeof FakeBridge>>,
    editors: [] as Array<InstanceType<typeof FakeEditor>>,
    panels: [] as Array<InstanceType<typeof FakePanel>>,
    calibrations: [] as Array<InstanceType<typeof FakeCalibration>>,
    diagnostics: [] as Array<InstanceType<typeof FakeDiagnostics>>,
    speech: [] as Array<InstanceType<typeof FakeSpeech>>,
    cloudClients: [] as Array<InstanceType<typeof FakeCloudClient>>,
    catalogs: [] as Array<InstanceType<typeof FakeCatalog>>,
    starting: Promise.resolve(),
    arms: true,
  };

  class FakeCloudClient {
    readonly voices = vi.fn(() => Promise.resolve({ voices: [] }));
    constructor(readonly readKey: () => Promise<string | undefined>) {
      made.cloudClients.push(this);
    }
  }

  class FakeCredentials {
    constructor(
      private readonly storage: {
        get(key: string): Promise<string | undefined>;
        store(key: string, value: string): Promise<void>;
        delete(key: string): Promise<void>;
      },
      private readonly prompt: () => Promise<string | undefined>,
      private readonly onCredentialChange: () => void,
    ) {}
    readonly read = vi.fn(() => this.storage.get('aiPair.elevenLabs.apiKey'));
    readonly hasKey = vi.fn(async () => (await this.read()) !== undefined);
    readonly set = vi.fn(async () => {
      const key = await this.prompt();
      if (key === undefined || key.length === 0) return;
      this.onCredentialChange();
      await this.storage.store('aiPair.elevenLabs.apiKey', key);
    });
    readonly remove = vi.fn(async () => {
      this.onCredentialChange();
      await this.storage.delete('aiPair.elevenLabs.apiKey');
    });
    readonly invalidate = vi.fn(() => {
      this.onCredentialChange();
    });
    readonly supersede = vi.fn();
  }

  class FakeCatalog {
    constructor(
      client: unknown,
      readonly publish: (view: CatalogView) => void,
    ) {
      void client;
      made.catalogs.push(this);
    }
    readonly contains = vi.fn(() => false);
    readonly load = vi.fn(() => {
      this.publish({ voices: [], more: false, loading: true, error: false });
      return Promise.resolve();
    });
    readonly invalidate = vi.fn();
  }

  class FakeSpeech {
    readonly speak = vi.fn<() => Promise<void>>().mockResolvedValue();
    readonly pause = vi.fn<() => void>();
    readonly resume = vi.fn<() => void>();
    readonly cancel = vi.fn<() => void>();
    readonly invalidateCloud = vi.fn<() => void>();
    readonly dispose = vi.fn<() => void>();
    readonly preview = vi.fn<() => Promise<void>>().mockResolvedValue();
    readonly audioEvent =
      vi.fn<(event: { id: number; pageId: number; event: 'started' | 'ended' | 'failed' }) => 'ended' | 'failed' | undefined>();
    readonly pageClosed = vi.fn();
    constructor(
      readonly options: {
        settings: () => { enabled: boolean; provider: string; voice: string; speed: number };
        output: SpeechOutput;
        localDesktop: boolean;
      },
    ) {
      made.speech.push(this);
    }
  }

  class FakeDiagnostics {
    readonly record = vi.fn<(event: unknown) => void>();
    readonly snapshot = vi.fn(() => ({ safe: 'snapshot' }));
    constructor(readonly identity: unknown) {
      made.diagnostics.push(this);
    }
  }

  /** Core's Controller, faked: what activate sets, and the calls its commands make. */
  class FakeController {
    trace?: (line: string) => void;
    onChange?: () => void;
    onDiagnostic?: (event: unknown) => void;
    isPaused = false;
    turn: string | undefined = undefined;
    saved: unknown = undefined;
    readonly setSpeed = vi.fn();
    readonly setReadingSpeed = vi.fn();
    readonly setCodePlayback = vi.fn();
    readonly setTiming = vi.fn();
    readonly setConfirmCommands = vi.fn();
    readonly pause = vi.fn();
    readonly resume = vi.fn();
    readonly userInterrupt = vi.fn();
    readonly takeTurn = vi.fn();
    readonly handBack = vi.fn();
    readonly endSession = vi.fn();
    readonly disconnect = vi.fn();
    readonly revive = vi.fn();

    constructor(
      readonly editor: unknown,
      readonly panel: unknown,
      readonly config: unknown,
      readonly narration: unknown,
    ) {
      made.controllers.push(this);
    }
  }

  /** Core's Bridge, faked: its options, and whether its server starts. */
  class FakeBridge {
    readonly file = '/discovery/1.json';
    readonly start = vi.fn(() => made.starting);
    readonly dispose = vi.fn();
    readonly focused = vi.fn();
    readonly writeDiscovery = vi.fn();

    constructor(
      readonly controller: unknown,
      readonly options: {
        workspaceFolders: () => string[];
        trace: (line: string) => void;
        failed: (error: unknown) => void;
        calibrate: (passage: unknown) => boolean;
        onDiagnostic: (event: unknown) => void;
      },
    ) {
      made.bridges.push(this);
    }
  }

  /** The editor, faked: what activate gives and sets it. */
  class FakeEditor {
    onSelection?: (ref: unknown) => void;
    readonly setAgentName = vi.fn();
    readonly programmerSelection = vi.fn(() => 'selection');
    readonly selectionRef = vi.fn(() => 'ref');
    readonly resolvePath = vi.fn((file: string) => `/project/${file}`);
    readonly dispose = vi.fn();
    readonly showTerminal = vi.fn(() => true);

    constructor(
      readonly root: string,
      readonly agentName: string,
      readonly controller: () => unknown,
      readonly showAutomatically: () => boolean,
      readonly onDiagnostic: (event: unknown) => void,
    ) {
      made.editors.push(this);
    }
  }

  /** The panel, faked: what activate gives and sets it, and what it shows. */
  class FakePanel {
    static readonly viewId = 'aiPair.panel';
    onPost?: () => void;
    readonly history = ['history'];
    readonly showSelection = vi.fn();
    readonly showSpeed = vi.fn();
    readonly showReadingSpeed = vi.fn();
    readonly showChatOrder = vi.fn();
    readonly showCodePlayback = vi.fn();
    readonly showSpeechSettings = vi.fn<(value: SpeechSettings) => void>();
    readonly showSpeechKeyStatus = vi.fn();
    readonly showSpeechCatalog = vi.fn();
    readonly showSpeechStatus = vi.fn();
    readonly playSpeech = vi.fn(() => 7);
    readonly controlSpeech = vi.fn();
    readonly refreshSpeechSupport = vi.fn();
    readonly speechPageIsReady = vi.fn(() => true);
    readonly showTerminalPreference = vi.fn();
    readonly showCalibration = vi.fn();
    readonly showTimings = vi.fn();
    readonly restoreHistory = vi.fn();
    readonly focusReply = vi.fn();
    readonly askStart = vi.fn();

    constructor(
      readonly resolvePath: (file: string) => string,
      readonly speed: { get: () => number; set: (value: number) => void },
      readonly readingSpeed: { get: () => number; set: (value: number) => void },
      readonly selection: { current: () => unknown; ref: () => unknown },
      readonly trace: (line: string) => void,
      readonly extensionUri: unknown,
      readonly wiring: {
        controller: () => unknown;
        calibration: () => unknown;
        starter: unknown;
        copyDiagnostics: () => Promise<void>;
        speech: PanelWiring['speech'];
      },
      readonly chatOrder: { get: () => string; set: (value: string) => void },
      readonly buildInfo: unknown,
      readonly terminalSettings: { get: () => boolean; set: (value: boolean) => void },
      readonly showTerminal: (id: number) => boolean,
      readonly codePlayback: { get: () => string; set: (value: string) => void },
    ) {
      made.panels.push(this);
    }
  }

  /** The calibration, faked: its host's hooks, and whether it takes a passage. */
  class FakeCalibration {
    readonly arm = vi.fn(() => made.arms);

    constructor(
      readonly host: {
        now: () => number;
        pause: () => void;
        resume: () => void;
        store: (msPerChar: number) => Promise<void>;
        show: (view: unknown) => void;
      },
      readonly passage: unknown,
    ) {
      made.calibrations.push(this);
    }
  }

  return {
    listeners,
    event,
    FakeController,
    FakeBridge,
    FakeEditor,
    FakePanel,
    FakeCalibration,
    FakeDiagnostics,
    FakeSpeech,
    FakeCloudClient,
    FakeCredentials,
    FakeCatalog,
    made,
    /** The workspace's folders; none until a test says. */
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    /** The `aiPair` settings, by name. */
    settings: new Map<string, unknown>(),
    delaySettings: false,
    providerGate: undefined as Promise<void> | undefined,
    updated: [] as Array<[string, unknown, unknown]>,
    commands: new Map<string, () => unknown>(),
    errors: [] as string[],
    infos: [] as string[],
    /** The button the programmer picks on the next information message. */
    answer: undefined as string | undefined,
    remoteName: undefined as string | undefined,
    workspaceProvider: undefined as string | undefined,
    logged: [] as Array<[string, string]>,
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  UIKind: { Desktop: 1 },
  workspace: {
    get workspaceFolders() {
      return fakes.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        key === 'speech.provider' && fakes.workspaceProvider !== undefined
          ? fakes.workspaceProvider
          : fakes.settings.has(key)
            ? fakes.settings.get(key)
            : fallback,
      inspect: (key: string) => ({ globalValue: fakes.settings.get(key) }),
      update: (key: string, value: unknown, target: unknown) => {
        fakes.updated.push([key, value, target]);
        if (key === 'speech.provider' && fakes.providerGate !== undefined) {
          const gate = fakes.providerGate;
          fakes.providerGate = undefined;
          return gate.then(() => {
            fakes.settings.set(key, value);
          });
        }
        if (!fakes.delaySettings) fakes.settings.set(key, value);
        return Promise.resolve();
      },
    }),
    onDidChangeConfiguration: fakes.event('configuration'),
    onDidChangeWorkspaceFolders: fakes.event('folders'),
  },
  window: {
    createOutputChannel: () => ({
      info: (line: string) => fakes.logged.push(['info', line]),
      trace: (line: string) => fakes.logged.push(['trace', line]),
      dispose: () => {},
    }),
    showInputBox: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: (message: string) => {
      fakes.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message: string) => {
      fakes.infos.push(message);
      return Promise.resolve(fakes.answer);
    },
    onDidChangeWindowState: fakes.event('window'),
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
  },
  env: {
    uiKind: 1,
    get remoteName() {
      return fakes.remoteName;
    },
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  },
  commands: {
    registerCommand: (name: string, run: () => unknown) => {
      fakes.commands.set(name, run);
      return { dispose: () => {} };
    },
  },
}));
vi.mock('node:os', () => ({ homedir: () => '/home' }));
vi.mock('@ai-pair/core', () => ({
  Bridge: fakes.FakeBridge,
  Controller: fakes.FakeController,
  isSavedSession: vi.fn(() => false),
}));
vi.mock('@ai-pair/protocol', () => ({ discoveryDir: () => '/discovery' }));
vi.mock('../src/demo', () => ({ playDemo: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/editor', () => ({ VsCodeEditor: fakes.FakeEditor }));
vi.mock('../src/diagnostics', () => ({ Diagnostics: fakes.FakeDiagnostics }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../src/speech_service', () => ({ SpeechService: fakes.FakeSpeech }));
vi.mock('../src/speech_elevenlabs', () => ({ ElevenLabsClient: fakes.FakeCloudClient }));
vi.mock('../src/speech_credentials', () => ({ SpeechCredentials: fakes.FakeCredentials }));
vi.mock('../src/speech_catalog', () => ({ SpeechCatalog: fakes.FakeCatalog }));
vi.mock('../src/speech_setup', () => ({
  installedSpeechModel: vi.fn(() => Promise.resolve(undefined)),
  setupSpeech: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/outside_watch', () => ({ watchOutside: vi.fn(() => ({ outside: 'outside', disposable: { dispose: () => {} } })) }));
vi.mock('../src/panel', () => ({ NarrationPanel: fakes.FakePanel }));
vi.mock('../src/panel_html', () => ({ settingSpeed: vi.fn((value: unknown) => (typeof value === 'number' ? value : 1)) }));
vi.mock('../src/setup', () => ({
  claudeStarter: vi.fn(() => ({ dispose: () => {} })),
  setUpAgent: vi.fn(() => Promise.resolve()),
  writeLauncher: vi.fn(() => '/ext/launcher'),
}));
vi.mock('../src/calibration', () => ({ Calibration: fakes.FakeCalibration }));
vi.mock('../src/timings', () => ({ timings: { saveMs: 200 }, setTimings: vi.fn() }));
vi.mock('../src/passage', () => ({ builtInPassage: vi.fn(() => ({ title: 'Built in', text: 'Built-in words.' })) }));

/** The extension's context, faked: its storage, and what it is asked to dispose. */
function context(stored: Map<string, unknown> = new Map(), offered = true) {
  const global = new Map<string, unknown>([['aiPair.offeredSetup', offered]]);
  return {
    subscriptions: [] as Array<{ dispose: () => unknown }>,
    extensionPath: '/ext',
    globalStorageUri: { fsPath: '/storage' },
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: fakes.event('secrets'),
    },
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: (key: string) => stored.get(key),
      update: (key: string, value: unknown) => {
        stored.set(key, value);
        return Promise.resolve();
      },
    },
    globalState: {
      get: (key: string) => global.get(key),
      update: (key: string, value: unknown) => {
        global.set(key, value);
        return Promise.resolve();
      },
    },
  };
}

/** Returns the one made last. */
function last<T>(list: T[]): T {
  const made = list.at(-1);
  if (made === undefined) throw new Error('Not made.');
  return made;
}

/** Activates the extension with `given`, and returns its Api and what it made. */
function activated(given = context()) {
  // The fake stands in for VS Code's ExtensionContext.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const api = activate(given as unknown as Parameters<typeof activate>[0]);
  return {
    api,
    context: given,
    controller: last(fakes.made.controllers),
    bridge: last(fakes.made.bridges),
    editor: last(fakes.made.editors),
    panel: last(fakes.made.panels),
    calibration: last(fakes.made.calibrations),
  };
}

/** Runs the command registered as `name`. */
function command(name: string): unknown {
  const run = fakes.commands.get(name);
  if (run === undefined) throw new Error(`No command ${name}.`);
  return run();
}

/** Fires event `name` with `value`. */
function fire(name: string, value: unknown): void {
  for (const listener of fakes.listeners.get(name) ?? []) {
    listener(value);
  }
}

/** Fires a settings change that affects the settings named. */
function changed(...names: string[]): void {
  fire('configuration', { affectsConfiguration: (section: string) => names.some((name) => section === `aiPair.${name}`) });
}

/** Save and simulate the supported host without depending on the CI machine. */
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
const diagnosticReport = process.report.getReport();
if (!('header' in diagnosticReport) || typeof diagnosticReport.header !== 'object' || diagnosticReport.header === null) {
  throw new Error('The process report has no header.');
}
Object.defineProperty(diagnosticReport.header, 'glibcVersionRuntime', { value: '2.35', configurable: true });

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  vi.spyOn(process.report, 'getReport').mockReturnValue(diagnosticReport);
  fakes.folders = [{ uri: { fsPath: '/project' } }];
  fakes.made.starting = Promise.resolve();
  fakes.made.arms = true;
  fakes.answer = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  if (originalPlatform !== undefined) Object.defineProperty(process, 'platform', originalPlatform);
  if (originalArch !== undefined) Object.defineProperty(process, 'arch', originalArch);
  fakes.listeners.clear();
  fakes.settings.clear();
  fakes.delaySettings = false;
  fakes.providerGate = undefined;
  fakes.commands.clear();
  for (const list of [fakes.made.controllers, fakes.made.bridges, fakes.made.editors, fakes.made.panels, fakes.made.calibrations]) {
    list.length = 0;
  }
  fakes.updated.length = 0;
  fakes.errors.length = 0;
  fakes.infos.length = 0;
  fakes.logged.length = 0;
});

describe('activate', () => {
  it('builds the editor in the first folder, or the home folder with none, and wires the controller to it', () => {
    const h = activated();
    expect(h.editor.root).toBe('/project');
    expect(h.editor.agentName).toBe('Agent');
    expect(h.editor.controller()).toBe(h.controller);
    expect(h.panel.extensionUri).toEqual({ fsPath: '/ext' });
    expect(h.panel.wiring.controller()).toBe(h.controller);
    expect(h.panel.wiring.calibration()).toBe(h.calibration);
    expect(h.panel.wiring.starter).toBe(vi.mocked(claudeStarter).mock.results[0]?.value);
    expect(h.api).toMatchObject({
      controller: h.controller,
      editor: h.editor,
      bridge: h.bridge,
      outside: 'outside',
      launcher: '/ext/launcher',
    });
    expect(writeLauncher).toHaveBeenCalledWith('/ext');
    expect(claudeStarter).toHaveBeenCalledWith('/ext/launcher');
    expect(watchOutside).toHaveBeenCalledWith(h.controller, h.editor, h.panel);
    expect(h.bridge.options.workspaceFolders()).toEqual(['/project']);
    fakes.folders = undefined;
    expect(activated().editor.root).toBe('/home');
    expect(activated().bridge.options.workspaceFolders()).toEqual([]);
  });

  it('gives the controller and the panel the speeds from the settings, and stores the ones the panel sets', () => {
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('confirmCommands', false);
    const h = activated();
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    expect(settingSpeed).toHaveBeenCalledWith(2);
    h.panel.speed.set(4);
    h.panel.readingSpeed.set(0.5);
    expect(fakes.updated).toEqual([
      ['speed', 4, 1],
      ['readingSpeed', 0.5, 1],
    ]);
    expect(h.panel.resolvePath('a.ts')).toBe('/project/a.ts');
    expect(h.panel.selection.current()).toBe('selection');
    expect(h.panel.selection.ref()).toBe('ref');
    h.editor.onSelection?.('a ref');
    expect(h.panel.showSelection).toHaveBeenCalledWith('a ref');
  });

  it('ChoiceSaved: reads, stores and applies the playback mode, defaulting invalid values to typing', () => {
    const h = activated();
    expect(h.controller.setCodePlayback).toHaveBeenCalledWith('typing');
    expect(h.panel.codePlayback.get()).toBe('typing');
    fakes.settings.set('codePlayback', 'blocks');
    changed('codePlayback');
    expect(h.controller.setCodePlayback).toHaveBeenLastCalledWith('blocks');
    expect(h.panel.showCodePlayback).toHaveBeenLastCalledWith('blocks');
    h.panel.codePlayback.set('lines');
    expect(fakes.updated).toContainEqual(['codePlayback', 'lines', 1]);
    fakes.settings.set('codePlayback', 'invalid');
    changed('codePlayback');
    expect(h.controller.setCodePlayback).toHaveBeenLastCalledWith('typing');
    expect(h.panel.showCodePlayback).toHaveBeenLastCalledWith('typing');
  });

  it('reads, saves, and applies the chat order, defaulting invalid values to newest first', () => {
    const h = activated();
    expect(h.panel.chatOrder.get()).toBe('newestFirst');
    fakes.settings.set('chatOrder', 'oldestFirst');
    expect(h.panel.chatOrder.get()).toBe('oldestFirst');
    changed('chatOrder');
    expect(h.panel.showChatOrder).toHaveBeenCalledWith('oldestFirst');
    h.panel.chatOrder.set('newestFirst');
    expect(fakes.updated).toContainEqual(['chatOrder', 'newestFirst', 1]);
    fakes.settings.set('chatOrder', 'invalid');
    changed('chatOrder');
    expect(h.panel.showChatOrder).toHaveBeenLastCalledWith('newestFirst');
  });

  it('exposes the same preview service and page readiness to integration tests', async () => {
    const h = activated();
    expect(h.api.speechPageReady()).toBe(true);
    await h.api.previewSpeech();
    expect(fakes.made.speech.at(-1)?.preview.mock.calls).toEqual([[]]);
  });

  it('exposes only the latest speech state and whether that unit started', () => {
    const h = activated();
    const speech = fakes.made.speech.at(-1);
    if (speech === undefined) throw new Error('Missing speech');
    expect(h.api.speechStatus()).toBeUndefined();
    speech.options.output.status(1, 'preparing');
    speech.options.output.status(1, 'speaking');
    speech.options.output.status(1, 'idle');
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true });
    // An idle status after a cancel is not an accepted audio end.
    speech.audioEvent.mockReturnValueOnce(undefined);
    h.panel.wiring.speech.event({ id: 1, pageId: 7, event: 'ended' });
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true });
    speech.audioEvent.mockReturnValueOnce('ended');
    h.panel.wiring.speech.event({ id: 1, pageId: 7, event: 'ended' });
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true, terminal: 'ended' });
    speech.options.output.status(2, 'unavailable', 'Audio could not play.');
    expect(h.api.speechStatus()).toEqual({ id: 2, state: 'unavailable', started: false, message: 'Audio could not play.' });
    speech.audioEvent.mockReturnValueOnce('failed');
    h.panel.wiring.speech.event({ id: 2, pageId: 8, event: 'failed' });
    expect(h.api.speechStatus()).toEqual({
      id: 2,
      state: 'unavailable',
      started: false,
      terminal: 'failed',
      message: 'Audio could not play.',
    });
    expect(h.panel.showSpeechStatus).toHaveBeenCalledWith(2, 'unavailable', 'Audio could not play.');
  });

  it('records only sanitized actual preview failures and panel diagnostics', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'received', provider: 'kokoro' });
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(8, 'unavailable', 'private provider detail');
      return Promise.resolve();
    });
    await h.panel.wiring.speech.preview();
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'preview', phase: 'failed', provider: 'kokoro', reason: 'unknown' },
    ]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private provider detail');
  });

  it('reports cloud capability without exposing key material', async () => {
    const ctx = context();
    ctx.secrets.get.mockResolvedValue('private-key');
    const h = activated(ctx);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.keyRefresh();
    await vi.waitFor(() => {
      expect(diagnostics.record.mock.calls).toContainEqual([
        { kind: 'speech', event: 'capability', provider: 'elevenlabs', phase: 'ready' },
      ]);
    });
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private-key');
  });

  it('reports cloud capability as unsupported on remote hosts', async () => {
    fakes.remoteName = 'remote';
    const ctx = context();
    ctx.secrets.get.mockResolvedValue('private-key');
    const h = activated(ctx);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.keyRefresh();
    await vi.waitFor(() => {
      expect(diagnostics.record.mock.calls).toContainEqual([
        { kind: 'speech', event: 'capability', provider: 'elevenlabs', phase: 'blocked', reason: 'unsupported' },
      ]);
    });
    fakes.remoteName = undefined;
  });

  it('keeps the newer preview diagnostic when an older preview settles late', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const diagnostics = last(fakes.made.diagnostics);
    const old = Promise.withResolvers<void>();
    const current = Promise.withResolvers<void>();
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(1, 'preparing');
      return old.promise;
    });
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(2, 'preparing');
      return current.promise;
    });
    const first = h.panel.wiring.speech.preview();
    const second = h.panel.wiring.speech.preview();
    old.resolve();
    await first;
    speech.options.output.status(2, 'speaking', 'private content');
    expect(diagnostics.record.mock.calls).toContainEqual([{ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'ready' }]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private content');
    current.resolve();
    await second;
  });

  it('copies a fresh diagnostic snapshot only on request and connects lifecycle sources', async () => {
    const h = activated();
    const diagnostics = fakes.made.diagnostics.at(-1);
    if (diagnostics === undefined) throw new Error('Missing diagnostics');
    h.editor.onDiagnostic({ kind: 'command', id: 4, phase: 'start' });
    h.controller.onDiagnostic?.({ kind: 'session', state: 'active' });
    h.bridge.options.onDiagnostic({ kind: 'connection', state: 'connected', connectionId: 1 });
    expect(diagnostics.record).toHaveBeenCalledTimes(3);
    expect(diagnostics.snapshot).not.toHaveBeenCalled();
    await h.panel.wiring.copyDiagnostics();
    expect(diagnostics.snapshot).toHaveBeenCalledOnce();
    expect(vi.mocked(vscode.env.clipboard, { deep: true }).writeText.mock.calls).toContainEqual([JSON.stringify({ safe: 'snapshot' })]);
  });

  it('wires local speech with safe defaults and stops it when disabled', () => {
    const h = activated();
    const speech = fakes.made.speech.at(-1);
    if (!speech) throw new Error('Missing speech service');
    expect(h.controller.narration).toBe(speech);
    expect(speech.options.settings()).toEqual({
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(speech.options.localDesktop).toBe(true);
    fakes.settings.set('speech.enabled', true);
    changed('speech', 'speech.enabled');
    fakes.settings.set('speech.voice', 'bf_emma');
    fakes.settings.set('speech.speed', 1.25);
    expect(speech.options.settings()).toEqual({
      enabled: true,
      provider: 'kokoro',
      voice: 'bf_emma',
      speed: 1.25,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    fakes.settings.set('speech.voice', 'invalid');
    fakes.settings.set('speech.speed', 9);
    expect(speech.options.settings()).toEqual({
      enabled: true,
      provider: 'kokoro',
      voice: 'invalid',
      speed: 9,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    fakes.settings.set('speech.enabled', false);
    changed('speech', 'speech.enabled');
    expect(speech.cancel).toHaveBeenCalledOnce();
  });

  it('routes settings, setup, page events and audio through the speech wiring', async () => {
    const h = activated();
    const speech = fakes.made.speech.at(-1);
    if (speech === undefined) throw new Error('Missing speech');
    const wiring = h.panel.wiring.speech;
    fakes.settings.set('speech.enabled', true);
    wiring.settings.set({ enabled: false, provider: 'kokoro', voice: 'bf_emma', speed: 1.25, elevenLabsVoice: '', elevenLabsSpeed: 1 });
    expect(speech.cancel).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(fakes.updated).toContainEqual(['speech.speed', 1.25, 1]);
    });
    expect(fakes.updated).toEqual(
      expect.arrayContaining([
        ['speech.enabled', false, 1],
        ['speech.voice', 'bf_emma', 1],
        ['speech.speed', 1.25, 1],
      ]),
    );
    wiring.settings.set({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 });
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(await wiring.installed()).toBe(false);
    vi.mocked(installedSpeechModel).mockResolvedValueOnce('/verified/model');
    expect(await wiring.installed()).toBe(true);
    await wiring.setup();
    expect(setupSpeech).toHaveBeenCalled();
    await wiring.preview();
    wiring.stop();
    wiring.event({ id: 1, pageId: 7, event: 'started' });
    wiring.pageClosed(7);
    expect(speech.preview).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalledTimes(2);
    expect(speech.audioEvent).toHaveBeenCalledWith({ id: 1, pageId: 7, event: 'started' });
    expect(speech.pageClosed).toHaveBeenCalledWith(7);
    expect(speech.options.output.play(1, new Uint8Array([1]), 10)).toBe(7);
    speech.options.output.control(1, 7, 'stop');
    expect(h.panel.controlSpeech).toHaveBeenCalledWith(1, 7, 'stop');
    changed('speech');
    expect(h.panel.showSpeechSettings).toHaveBeenCalled();
  });

  it('keeps setup unavailable when this package has no speech runtime', async () => {
    vi.mocked(speechRuntimeAvailable).mockResolvedValue(false);
    const h = activated();
    await Promise.resolve();
    expect(h.panel.wiring.speech.supported()).toBe(false);
    expect(h.panel.refreshSpeechSupport.mock.calls).toEqual([[]]);
  });

  it('enables speech controls once the packaged runtime is available', async () => {
    vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
    const h = activated();
    expect(h.panel.wiring.speech.supported()).toBe(false);
    await Promise.resolve();
    expect(h.panel.wiring.speech.supported()).toBe(true);
    expect(h.panel.refreshSpeechSupport.mock.calls).toEqual([[]]);
  });

  it('disables local speech when the host platform report fails', () => {
    vi.spyOn(process.report, 'getReport').mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    const h = activated();
    expect(h.panel.wiring.speech.supported()).toBe(false);
  });

  it('NoSecret: uses the native masked prompt and does not put a key in settings or logs', async () => {
    const h = activated();
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('test-secret');
    await h.panel.wiring.speech.keySet();
    expect(vi.mocked(vscode.window.showInputBox).mock.calls.at(-1)?.[0]).toMatchObject({ password: true });
    expect(h.context.secrets.store.mock.calls).toEqual([['aiPair.elevenLabs.apiKey', 'test-secret']]);
    expect(JSON.stringify(fakes.updated)).not.toContain('test-secret');
    expect(JSON.stringify(fakes.logged)).not.toContain('test-secret');
    expect(JSON.stringify(h.panel.history)).not.toContain('test-secret');
  });

  it('cancels active speech when provider or credentials change and keeps settings separate', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const wiring = h.panel.wiring.speech;
    expect(wiring.cloudSupported()).toBe(true);
    expect(wiring.validCloudVoice('missing')).toBe(false);
    wiring.loadVoices(true);
    wiring.settings.set({
      enabled: true,
      provider: 'elevenlabs',
      voice: 'bf_emma',
      speed: 1.25,
      elevenLabsVoice: 'voice1',
      elevenLabsSpeed: 1.2,
    });
    expect(speech.cancel.mock.calls).toHaveLength(1);
    await vi.waitFor(() => {
      expect(fakes.updated).toContainEqual(['speech.elevenLabsVoice', 'voice1', 1]);
    });
    expect(fakes.updated).toContainEqual(['speech.provider', 'elevenlabs', 1]);
    expect(fakes.updated).toContainEqual(['speech.elevenLabsVoice', 'voice1', 1]);
    fire('secrets', { key: 'unrelated' });
    expect(speech.invalidateCloud.mock.calls).toEqual([]);
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(speech.invalidateCloud.mock.calls).toEqual([[]]);
    await wiring.keyRemove();
    expect(h.context.secrets.delete.mock.calls).toEqual([['aiPair.elevenLabs.apiKey']]);
    changed('speech', 'speech.provider');
    expect(speech.cancel.mock.calls).toHaveLength(1);
  });

  it('reports key command failures without revealing errors', async () => {
    const h = activated();
    h.context.secrets.store.mockRejectedValueOnce(new Error('private'));
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('test-secret');
    await command('aiPair.setElevenLabsKey');
    expect(fakes.errors).toContain('Could not save the ElevenLabs API key.');
    h.context.secrets.delete.mockRejectedValueOnce(new Error('private'));
    await command('aiPair.removeElevenLabsKey');
    expect(fakes.errors).toContain('Could not remove the ElevenLabs API key.');
    expect(JSON.stringify(fakes.errors)).not.toContain('private');
  });

  it('ProviderAligned: uses a selected provider immediately while its global setting is still being saved', () => {
    const h = activated();
    fakes.delaySettings = true;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('elevenlabs');
    fakes.delaySettings = false;
  });

  it('restores only a newly selected catalog voice after the key reset is saved', async () => {
    fakes.settings.set('speech.elevenLabsVoice', 'old');
    const h = activated();
    const catalog = last(fakes.made.catalogs);
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('');
    });
    catalog.contains.mockReturnValue(true);
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'new-account-voice',
      elevenLabsSpeed: 1,
    });
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('new-account-voice');
    });
    await vi.waitFor(() => {
      expect(h.panel.showSpeechSettings.mock.lastCall?.[0].elevenLabsVoice).toBe('new-account-voice');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('new-account-voice');
  });

  it('records only sanitized catalog completion facts and ignores reset as a success', () => {
    const h = activated();
    const catalog = last(fakes.made.catalogs);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: false, reset: true });
    expect(diagnostics.record.mock.calls).not.toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready', reason: 'no_voice' },
    ]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: true, errorKind: 'auth' });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'failed', reason: 'auth' },
    ]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: false });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready', reason: 'no_voice' },
    ]);
  });

  it('records loaded catalogs and unknown errors only after an actual request', () => {
    const h = activated();
    const catalog = last(fakes.made.catalogs);
    const diagnostics = last(fakes.made.diagnostics);
    catalog.publish({ voices: [], more: false, loading: false, error: false });
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [{ id: 'opaque', name: 'Voice' }], more: false, loading: false, error: false });
    expect(diagnostics.record.mock.calls).toContainEqual([{ kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready' }]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: true });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'failed', reason: 'unknown' },
    ]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('opaque');
  });

  it('KeyClearsVoice: clears an old account voice even while a settings save is pending', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'old-account-voice',
      elevenLabsSpeed: 1,
    });
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
  });

  it('KeyClearsVoice: keeps the old account voice unavailable when a key-reset write fails', async () => {
    fakes.settings.set('speech.elevenLabsVoice', 'old-account-voice');
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
    gate.reject(new Error('private'));
    await vi.waitFor(() => {
      expect(fakes.errors).toContain('Could not save speech settings.');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
  });

  it('ProviderAligned: does not cancel a preview on delayed settings echoes or unchanged disabled state', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(speech.cancel.mock.calls).toHaveLength(1);
    changed('speech', 'speech.provider', 'speech.enabled');
    expect(speech.cancel.mock.calls).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('elevenlabs');
    });
    changed('speech', 'speech.enabled');
    expect(speech.cancel.mock.calls).toHaveLength(1);
  });

  it('LatestHonored, Settlement: keeps the latest choice when an older global write settles', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    const base = { enabled: false, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
    h.panel.wiring.speech.settings.set({ ...base, provider: 'elevenlabs' });
    h.panel.wiring.speech.settings.set({ ...base, provider: 'kokoro' });
    changed('speech', 'speech.provider');
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('kokoro');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
  });

  it('LatestHonored: does not roll back a newer provider when an older write fails', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    const base = { enabled: false, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
    h.panel.wiring.speech.settings.set({ ...base, provider: 'elevenlabs' });
    h.panel.wiring.speech.settings.set({ ...base, provider: 'kokoro' });
    gate.reject(new Error('old failure'));
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('kokoro');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    expect(fakes.errors).not.toContain('Could not save speech settings.');
  });

  it('Settlement: rolls back the latest provider and reports a failed settings write', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('elevenlabs');
    gate.reject(new Error('private settings failure'));
    await vi.waitFor(() => {
      expect(fakes.errors).toContain('Could not save speech settings.');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    expect(JSON.stringify(fakes.errors)).not.toContain('private');
  });

  it('cancels on a genuine external provider change after pending writes settle', () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    fakes.settings.set('speech.provider', 'elevenlabs');
    changed('speech', 'speech.provider');
    expect(speech.cancel.mock.calls).toHaveLength(1);
    expect(h.panel.showSpeechSettings.mock.lastCall?.[0].provider).toBe('elevenlabs');
  });

  it('TypeOK: ignores workspace attempts to select the cloud provider', () => {
    fakes.workspaceProvider = 'elevenlabs';
    activated();
    expect(fakes.made.speech.at(-1)?.options.settings().provider).toBe('kokoro');
    fakes.workspaceProvider = undefined;
  });

  it('does not enable local speech on a remote extension host', () => {
    fakes.remoteName = 'ssh-remote';
    activated();
    expect(fakes.made.speech.at(-1)?.options.localDesktop).toBe(false);
    fakes.remoteName = undefined;
  });

  it('reads, saves and applies automatic terminal visibility and routes a reveal by ID', () => {
    const h = activated();
    expect(h.editor.showAutomatically()).toBe(false);
    expect(h.panel.terminalSettings.get()).toBe(false);
    fakes.settings.set('showTerminalsAutomatically', true);
    expect(h.editor.showAutomatically()).toBe(true);
    expect(h.panel.terminalSettings.get()).toBe(true);
    changed('showTerminalsAutomatically');
    expect(h.panel.showTerminalPreference).toHaveBeenCalledWith(true);
    h.panel.terminalSettings.set(false);
    expect(fakes.updated).toContainEqual(['showTerminalsAutomatically', false, 1]);
    expect(h.panel.showTerminal(42)).toBe(true);
    expect(h.editor.showTerminal).toHaveBeenCalledWith(42);
    fakes.settings.set('showTerminalsAutomatically', 'false');
    expect(h.editor.showAutomatically()).toBe(false);
    expect(h.panel.terminalSettings.get()).toBe(false);
  });

  it('traces the controller at Info, and the panel and the bridge at the Trace level, or at Info with the setting', () => {
    const h = activated();
    h.controller.trace?.('one');
    h.panel.trace('two');
    fakes.settings.set('trace', true);
    h.bridge.options.trace('three');
    expect(fakes.logged).toEqual([
      ['info', 'one'],
      ['trace', 'two'],
      ['info', 'three'],
    ]);
  });

  it('applies each setting as it changes, and only those that changed', () => {
    const h = activated();
    vi.clearAllMocks();
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('agentName', 'Pal');
    fakes.settings.set('confirmCommands', false);
    changed('speed', 'readingSpeed', 'timing', 'agentName', 'confirmCommands');
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.panel.showSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.panel.showReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.editor.setAgentName).toHaveBeenCalledWith('Pal');
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    vi.clearAllMocks();
    changed('trace');
    expect(h.controller.setSpeed).not.toHaveBeenCalled();
    expect(h.controller.setReadingSpeed).not.toHaveBeenCalled();
    expect(h.controller.setTiming).not.toHaveBeenCalled();
    expect(h.editor.setAgentName).not.toHaveBeenCalled();
    expect(h.controller.setConfirmCommands).not.toHaveBeenCalled();
  });

  it('tells the bridge when the window is focused, and when the folders change', () => {
    const h = activated();
    fire('window', { focused: false });
    expect(h.bridge.focused).not.toHaveBeenCalled();
    fire('window', { focused: true });
    expect(h.bridge.focused).toHaveBeenCalledOnce();
    fire('folders', {});
    expect(h.bridge.writeDiscovery).toHaveBeenCalledOnce();
  });

  it('says once that the discovery file could not be written, and that the server could not start', async () => {
    fakes.made.starting = Promise.reject(new Error('EACCES'));
    const h = activated();
    h.bridge.options.failed(new Error('read-only'));
    h.bridge.options.failed(new Error('read-only'));
    await expect(h.api.ready).rejects.toThrow('EACCES');
    await Promise.resolve();
    expect(fakes.errors).toEqual([
      "AI Pair couldn't write its discovery file, so agents won't find this window: Error: read-only",
      "AI Pair couldn't start its local server: Error: EACCES",
    ]);
  });

  it('disposes the bridge, disconnects the controller, and saves, as the window goes', () => {
    const h = activated();
    for (const disposable of h.context.subscriptions) {
      void disposable.dispose();
    }
    expect(h.bridge.dispose).toHaveBeenCalledOnce();
    expect(h.controller.disconnect).toHaveBeenCalledOnce();
  });
});

describe('the session across a reload', () => {
  it('revives a saved session, with its history when the history is panel events', () => {
    vi.mocked(isSavedSession).mockReturnValue(true);
    const stored = new Map<string, unknown>([
      ['aiPair.session', { saved: true }],
      ['aiPair.history', [{ type: 'say' }]],
    ]);
    const h = activated(context(stored));
    expect(h.panel.restoreHistory).toHaveBeenCalledWith([{ type: 'say' }]);
    expect(h.controller.revive).toHaveBeenCalledWith({ saved: true });
    for (const history of [[{ text: 'no type' }], 'not a list']) {
      stored.set('aiPair.history', history);
      expect(activated(context(stored)).panel.restoreHistory).toHaveBeenLastCalledWith([]);
    }
  });

  it('saves the session and its history a while after each change, and nothing once the session is gone', () => {
    vi.useFakeTimers();
    const stored = new Map<string, unknown>();
    const h = activated(context(stored));
    expect(h.controller.revive).not.toHaveBeenCalled();
    h.controller.saved = { session: 1 };
    h.controller.onChange?.();
    h.panel.onPost?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.session')).toEqual({ session: 1 });
    expect(stored.get('aiPair.history')).toEqual(['history']);
    vi.mocked(isSavedSession).mockReturnValue(true);
    expect(h.api.saved()).toEqual({ session: 1 });
    vi.mocked(isSavedSession).mockReturnValue(false);
    expect(h.api.saved()).toBeUndefined();
    h.controller.saved = undefined;
    h.controller.onChange?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.history')).toBeUndefined();
    expect(h.api.history()).toEqual(['history']);
  });

  it("setTimings: sets the extension's delays and tells the page its own", () => {
    const h = activated();
    h.api.setTimings({ saveMs: 1 });
    expect(vi.mocked(setTimings)).toHaveBeenCalledWith({ saveMs: 1 });
    expect(h.panel.showTimings).toHaveBeenCalledOnce();
  });
});

describe('the commands', () => {
  it('pauses or resumes, interrupts, takes or hands back the turn, and ends the session', () => {
    const h = activated();
    command('aiPair.togglePause');
    expect(h.controller.pause).toHaveBeenCalledOnce();
    h.controller.isPaused = true;
    command('aiPair.togglePause');
    expect(h.controller.resume).toHaveBeenCalledOnce();
    command('aiPair.interrupt');
    expect(h.controller.userInterrupt).toHaveBeenCalledOnce();
    command('aiPair.toggleTurn');
    expect(h.controller.takeTurn).toHaveBeenCalledOnce();
    h.controller.turn = 'programmer';
    command('aiPair.toggleTurn');
    expect(h.controller.handBack).toHaveBeenCalledOnce();
    command('aiPair.endSession');
    expect(h.controller.endSession).toHaveBeenCalledOnce();
    command('aiPair.focusReply');
    command('aiPair.askAboutSelection');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(2);
  });

  it('plays the demo in the folder, or says to open one, and plays it through the Api', async () => {
    const h = activated();
    command('aiPair.playDemo');
    expect(playDemo).toHaveBeenCalledWith(h.controller, '/project');
    await h.api.playDemo();
    expect(playDemo).toHaveBeenCalledTimes(2);
    for (const none of [[], undefined]) {
      fakes.folders = none;
      command('aiPair.playDemo');
    }
    expect(fakes.errors).toEqual([
      'Open a folder first: the demo creates files in ai-pair-demo/.',
      'Open a folder first: the demo creates files in ai-pair-demo/.',
    ]);
    expect(playDemo).toHaveBeenCalledTimes(2);
  });

  it('ReaskedProp: sets the agent up, and offers the panel the start again', async () => {
    const h = activated();
    await command('aiPair.setUpAgent');
    expect(setUpAgent).toHaveBeenCalledWith('/ext/launcher');
    expect(h.panel.askStart).toHaveBeenCalledOnce();
  });

  it('offers Set Up Agent once, the first time, and sets the agent up when it is taken', async () => {
    fakes.answer = 'Set Up Agent';
    const first = context(new Map(), /* offered= */ false);
    activated(first);
    await vi.waitFor(() => {
      expect(setUpAgent).toHaveBeenCalledOnce();
    });
    expect(fakes.infos).toEqual(['AI Pair is installed. Connect it to your agent?']);
    expect(first.globalState.get('aiPair.offeredSetup')).toBe(true);
    fakes.answer = undefined;
    activated(context(new Map(), /* offered= */ false));
    await Promise.resolve();
    expect(setUpAgent).toHaveBeenCalledOnce();
  });
});

describe('the calibration', () => {
  it("starts with the setting's passage, the built-in one when it has no text, and says when one is under way", () => {
    const h = activated();
    const passages: Array<[unknown, unknown]> = [
      [undefined, { title: 'Built in', text: 'Built-in words.' }],
      ['not an object', { title: 'Built in', text: 'Built-in words.' }],
      [{ text: '  ' }, { title: 'Built in', text: 'Built-in words.' }],
      [
        { title: 5, text: 'Words.' },
        { title: 'Your passage', text: 'Words.' },
      ],
      [
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
      ],
    ];
    for (const [setting, passage] of passages) {
      fakes.settings.set('calibrationPassage', setting);
      command('aiPair.calibrate');
      expect(h.calibration.arm).toHaveBeenLastCalledWith(passage);
    }
    expect(builtInPassage).toHaveBeenCalledWith('/ext');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(passages.length);
    fakes.made.arms = false;
    command('aiPair.calibrate');
    expect(fakes.infos).toEqual(['AI Pair: a calibration is already under way in the Pair panel.']);
  });

  it("takes an agent's passage through the bridge and keeps it as the setting, unless one is under way", () => {
    const h = activated();
    const passage = { title: 'Agent', text: 'Words.' };
    expect(h.bridge.options.calibrate(passage)).toBe(true);
    expect(fakes.updated).toEqual([['calibrationPassage', passage, 1]]);
    fakes.made.arms = false;
    expect(h.bridge.options.calibrate(passage)).toBe(false);
    expect(fakes.updated).toHaveLength(1);
  });

  it('pauses and resumes the controller, shows its views in the panel, and stores the rate it measured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    fakes.settings.set('timing', { glideMs: 1, reading: { minMs: 9 } });
    const h = activated();
    const { host } = h.calibration;
    expect(host.now()).toBe(42);
    host.pause();
    expect(h.controller.pause).toHaveBeenCalledWith('calibrate');
    host.resume();
    expect(h.controller.resume).toHaveBeenCalledWith('calibrate');
    host.show('a view');
    expect(h.panel.showCalibration).toHaveBeenCalledWith('a view');
    await host.store(50);
    expect(fakes.updated).toEqual([['timing', { glideMs: 1, reading: { minMs: 9, msPerChar: 50 } }, 1]]);
    expect(h.controller.setTiming).toHaveBeenLastCalledWith({ glideMs: 1, reading: { minMs: 9, msPerChar: 50 } });
    for (const timing of [undefined, { reading: 'fast' }]) {
      fakes.settings.set('timing', timing);
      await host.store(60);
      // A setting that isn't an object, or whose `reading` isn't, is started afresh.
      expect(fakes.updated.at(-1)?.[1]).toEqual({ reading: { msPerChar: 60 } });
    }
  });
});

describe('deactivate', () => {
  it('does nothing: the context disposes everything', () => {
    expect(() => {
      deactivate();
    }).not.toThrow();
  });
});

it('passes a host-only key reader to the cloud client', async () => {
  const given = context();
  given.secrets.get.mockResolvedValue('synthetic-key');
  activated(given);
  expect(await last(fakes.made.cloudClients).readKey()).toBe('synthetic-key');
});

it('reports unavailable key status on a failed read and after successful commands', async () => {
  const given = context();
  given.secrets.get.mockRejectedValueOnce(new Error('private'));
  const h = activated(given);
  h.panel.wiring.speech.keyRefresh();
  await vi.waitFor(() => {
    expect(h.panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('synthetic-key');
  await command('aiPair.setElevenLabsKey');
  await command('aiPair.removeElevenLabsKey');
  expect(given.secrets.store).toHaveBeenCalledOnce();
  expect(given.secrets.delete).toHaveBeenCalledOnce();
  expect(JSON.stringify(fakes.logged)).not.toContain('synthetic-key');
});

it('ignores a stale failed key-status read after a newer successful read', async () => {
  const given = context();
  const stale = Promise.withResolvers<string | undefined>();
  given.secrets.get.mockReturnValueOnce(stale.promise).mockResolvedValueOnce('synthetic-key');
  const h = activated(given);
  h.panel.wiring.speech.keyRefresh();
  h.panel.wiring.speech.keyRefresh();
  await vi.waitFor(() => {
    expect(h.panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  stale.reject(new Error('private'));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.panel.showSpeechKeyStatus).not.toHaveBeenCalledWith(false);
});

it('records bounded local worker readiness and failure facts', () => {
  activated();
  const output = last(fakes.made.speech).options.output;
  output.localDiagnostic?.('ready');
  output.localDiagnostic?.('failed', 'worker_native');
  const calls = last(fakes.made.diagnostics).record.mock.calls;
  expect(calls).toContainEqual([{ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'ready' }]);
  expect(calls).toContainEqual([{ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'failed', reason: 'worker_native' }]);
});
