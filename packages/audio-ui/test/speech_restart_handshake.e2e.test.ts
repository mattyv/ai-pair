import { afterEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION, type LocalAudioFrame } from '@ai-pair/protocol';
import type { AudioEvent, AudioOwner } from '../../audio-native/src';
import { LOCAL_CAPABILITIES, LOCAL_PROTOCOL_VERSION } from '../../vscode/src/speech_local_protocol';
import { activate, deactivate } from '../src/extension';
import { WorkspaceSession } from '../../vscode/src/workspace_session';
import { PanelPlacement } from '../../vscode/src/panel_placement';

const fake = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  providers: 0,
  routing: undefined as { forward(action: import('@ai-pair/protocol').LocalPanelAction, page: number): void } | undefined,
  workspace: undefined as import('../../vscode/src/workspace_session').WorkspaceSession | undefined,
  frames: [] as Array<import('@ai-pair/protocol').LocalAudioFrame>,
  inbound: [] as unknown[],
  workers: [] as Array<{ exit(): void; requests: unknown[]; terminate: ReturnType<typeof vi.fn> }>,
  outputListener: undefined as ((event: import('../../audio-native/src').AudioEvent) => void) | undefined,
  owner: undefined as import('../../audio-native/src').AudioOwner | undefined,
}));

vi.mock('vscode', () => ({
  env: { uiKind: 1 },
  UIKind: { Desktop: 1 },
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
      fake.commands.set(name, callback);
      return { dispose: () => {} };
    },
    executeCommand: (name: string, value: unknown) => {
      if (name === 'aiPair.localAudio.workspace') {
        fake.inbound.push(value);
        return Promise.resolve(fake.workspace?.accept(value) ?? false);
      }
      return Promise.resolve(fake.commands.get(name)?.(value));
    },
  },
  workspace: {
    getConfiguration: () => ({ get: (key: string) => (key === 'speech.enabled' ? true : undefined), inspect: () => ({}), update: vi.fn() }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
  window: {
    registerWebviewViewProvider: () => {
      fake.providers++;
      return {
        dispose: () => {
          fake.providers--;
        },
      };
    },
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));
vi.mock('../../vscode/src/panel', () => ({
  NarrationPanel: class {
    static viewId = 'aiPair.narration';
    useCompanion(value: typeof fake.routing) {
      fake.routing = value;
    }
    speechReadyPageId() {
      return 7;
    }
    showSpeechTransport() {}
    showSpeechReadiness() {}
    showSpeechKeyStatus() {}
    showSpeechOutputCatalog() {}
    showSpeechCatalog() {}
    showSpeechSettings() {}
    showSpeechComputeState() {}
    showSpeechStatus() {}
    refreshSpeechSupport() {}
  },
}));
vi.mock('../../vscode/src/speech_setup', () => ({
  installedSpeechModel: vi.fn().mockResolvedValue('/model'),
  speechModelStatus: vi.fn(),
  setupSpeech: vi.fn(),
}));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn().mockResolvedValue(true) }));
vi.mock('../../audio-native/src/factory', () => ({
  createLocalAudioAdapter: () => ({
    capabilities: () =>
      Promise.resolve({ backend: 'fake', location: 'ui', defaultOutput: true, deviceSelection: false, pauseResume: true }),
    list: () => Promise.resolve([]),
    admit: (owner: AudioOwner) => {
      fake.owner = owner;
      return Promise.resolve('lease');
    },
    play: () => {
      const owner = fake.owner;
      if (owner !== undefined) {
        queueMicrotask(() => {
          fake.outputListener?.({ owner, sequence: 1, part: 0, type: 'started' });
        });
        queueMicrotask(() => {
          fake.outputListener?.({ owner, sequence: 2, part: 0, type: 'ended' });
        });
      }
      return Promise.resolve();
    },
    pause: async () => {},
    resume: async () => {},
    stop: async () => {},
    onEvent: (listener: (event: AudioEvent) => void) => {
      fake.outputListener = listener;
      return { dispose: () => {} };
    },
  }),
}));
vi.mock('node:worker_threads', async () => {
  const { encodeTempoWav } = await vi.importActual<typeof import('../../vscode/src/speech_tempo_pcm')>('../../vscode/src/speech_tempo_pcm');
  return {
    Worker: class {
      requests: unknown[] = [];
      listeners = new Map<string, (value: unknown) => void>();
      terminate = vi.fn(() => Promise.resolve(0));
      constructor() {
        fake.workers.push(this);
      }
      on(event: string, listener: (value: unknown) => void) {
        this.listeners.set(event, listener);
        return this;
      }
      postMessage(value: { type: string; epoch: number; id: number; part: number }) {
        this.requests.push(value);
        if (value.type === 'init') {
          queueMicrotask(() => {
            this.listeners.get('message')?.({
              type: 'ready',
              version: LOCAL_PROTOCOL_VERSION,
              epoch: value.epoch,
              capabilities: LOCAL_CAPABILITIES,
            });
          });
        }
        if (value.type === 'synthesize') {
          queueMicrotask(() => {
            this.listeners.get('message')?.({
              type: 'result',
              version: LOCAL_PROTOCOL_VERSION,
              epoch: value.epoch,
              id: value.id,
              part: value.part,
              wav: encodeTempoWav(new Int16Array(12_000).fill(2000), false).wav,
              durationMs: 500,
            });
          });
        }
      }
      exit() {
        this.listeners.get('exit')?.(0);
      }
    },
  };
});

function context(): vscode.ExtensionContext {
  // The fixture implements the VS Code surface used by the real session and host.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    extensionPath: '/extension',
    extensionUri: {},
    globalStorageUri: { fsPath: '/storage' },
    subscriptions: [],
    secrets: {
      get: () => Promise.resolve(undefined),
      store: async () => {},
      delete: async () => {},
      onDidChange: () => ({ dispose: () => {} }),
    },
    globalState: { get: () => undefined, update: async () => {} },
  } as unknown as vscode.ExtensionContext;
}
function command(name: string, value?: unknown): unknown {
  return fake.commands.get(`aiPair.localAudio.${name}`)?.(value);
}
function workspace(epoch: string): WorkspaceSession {
  const result = new WorkspaceSession({
    epoch,
    panel: { attachRemote: () => {}, receiveRemote: () => {}, closeRemote: () => {} },
    send: (frame: LocalAudioFrame) => {
      fake.frames.push(frame);
      if (command('frame', frame) !== true) return Promise.reject(new Error('frame rejected'));
      return Promise.resolve();
    },
    lost: () => {},
  });
  fake.workspace = result;
  return result;
}
afterEach(async () => {
  fake.workspace?.dispose();
  fake.workspace = undefined;
  for (const worker of fake.workers) worker.exit();
  await deactivate();
  fake.commands.clear();
  fake.workers.length = 0;
  fake.frames.length = 0;
  fake.inbound.length = 0;
  fake.routing = undefined;
  fake.providers = 0;
});

it('RestartHandshake: waits for old worker exit before attaching the fresh epoch and preserves first narration', async () => {
  activate(context());
  const oldPrepared = command('prepare', { version: LOCAL_AUDIO_VERSION, epoch: 'old' });
  expect(await command('commit', oldPrepared)).toBe(true);
  const oldWorkspace = workspace('old');
  fake.routing?.forward({ type: 'ready' }, 7);
  await vi.waitFor(() => {
    expect(oldWorkspace.pageReady()).toBe(true);
  });
  const oldSpeech = oldWorkspace.narration.speak('Old speech.');
  await vi.waitFor(() => {
    expect(fake.workers).toHaveLength(1);
  });
  await oldSpeech;
  activate(context());
  expect(fake.workers[0]?.terminate).toHaveBeenCalledOnce();
  let fresh: WorkspaceSession | undefined;
  let commitStarted = false;
  const placement = new PanelPlacement({
    epoch: 'new',
    remote: false,
    timeoutMs: 5000,
    prepare: () => Promise.resolve(command('prepare', { version: LOCAL_AUDIO_VERSION, epoch: 'new' })),
    commit: (prepared) => {
      commitStarted = true;
      return Promise.resolve(command('commit', prepared));
    },
    afterCommit: () => {
      fresh = workspace('new');
    },
  });
  const choosing = placement.choose();
  await vi.waitFor(() => {
    expect(commitStarted).toBe(true);
  });
  expect(command('commit', { version: LOCAL_AUDIO_VERSION, epoch: 'wrong', token: 'wrong' })).toBe(false);
  expect(fresh).toBeUndefined();
  expect(fake.providers).toBe(0);
  expect(fake.frames.filter((frame) => frame.connectionEpoch === 'new')).toHaveLength(0);
  fake.workers[0]?.exit();
  expect(await choosing).toBe('companion');
  expect(fake.providers).toBe(1);
  expect(fresh).toBeDefined();
  fake.routing?.forward({ type: 'ready' }, 7);
  await vi.waitFor(() => {
    expect(fresh?.pageReady()).toBe(true);
  });
  await fresh?.narration.speak('First fresh speech.');
  expect(fake.workers).toHaveLength(2);
  expect(fake.workers[1]?.requests).toContainEqual(expect.objectContaining({ type: 'synthesize', text: 'First fresh speech.' }));
  expect(fake.inbound).toContainEqual(expect.objectContaining({ type: 'terminal', connectionEpoch: 'new', outcome: 'ended' }));
  oldWorkspace.dispose();
});

it('CanceledReplacement: a committed replacement disposed before old exit never registers', async () => {
  activate(context());
  const oldPrepared = command('prepare', { version: LOCAL_AUDIO_VERSION, epoch: 'old' });
  expect(await command('commit', oldPrepared)).toBe(true);
  const oldWorkspace = workspace('old');
  fake.routing?.forward({ type: 'ready' }, 7);
  await vi.waitFor(() => {
    expect(oldWorkspace.pageReady()).toBe(true);
  });
  const speech = oldWorkspace.narration.speak('Old speech.');
  await vi.waitFor(() => {
    expect(fake.workers).toHaveLength(1);
  });
  await speech;
  const replacement = context();
  activate(replacement);
  const prepared = command('prepare', { version: LOCAL_AUDIO_VERSION, epoch: 'new' });
  const commit = Promise.resolve(command('commit', prepared));
  expect(fake.providers).toBe(0);
  for (const subscription of replacement.subscriptions) subscription.dispose();
  fake.workers[0]?.exit();
  expect(await commit).toBe(false);
  expect(fake.providers).toBe(0);
  expect(fake.workers).toHaveLength(1);
  oldWorkspace.dispose();
});
