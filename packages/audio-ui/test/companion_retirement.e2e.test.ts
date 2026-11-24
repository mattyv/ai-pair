import { LOCAL_AUDIO_VERSION, type ChannelLoss, type LocalAudioFrame, type LocalPanelAction } from '@ai-pair/protocol';
import { expect, it, vi } from 'vitest';
import { activate, deactivate } from '../src/extension';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';

interface Routing {
  forward(action: LocalPanelAction, page: number): void;
  closed(page: number): void;
}
interface ConnectionOptions {
  lost(): void;
  receive(frame: LocalAudioFrame): void;
}
interface ChannelOptions {
  lost(reason: ChannelLoss): void;
  send(frame: LocalAudioFrame): Promise<void>;
}
interface HostOptions {
  page(): number | undefined;
  panel(): unknown;
  diagnostic(event: unknown): void;
  gpuProof?: import('../../vscode/src/speech_gpu_binding').GpuBindingDependencies['proof'];
  enableGpuInference?: boolean;
}
interface NarrationOptions {
  page(): number | undefined;
  nextSequence(): number;
  stopOutput(): Promise<void>;
  observation(): unknown;
  send(frame: LocalAudioFrame): void;
}

const fake = vi.hoisted(() => ({
  commands: new Map<string, (value: unknown) => unknown>(),
  proof: vi.fn<() => Promise<import('../../vscode/src/speech_gpu_check').GpuProbeResult>>().mockResolvedValue('failed'),
  proofCapability: undefined as import('../../vscode/src/speech_gpu_client').GpuLaunchCapability | undefined,
  routing: undefined as Routing | undefined,
  connectionOptions: undefined as ConnectionOptions | undefined,
  channelOptions: undefined as ChannelOptions | undefined,
  hostOptions: undefined as HostOptions | undefined,
  narrationOptions: undefined as NarrationOptions | undefined,
  panelArgs: vi.fn<(...args: unknown[]) => void>(),
  showShortcuts: vi.fn<(labels: unknown) => void>(),
  watcherArgs: vi.fn<(directory: unknown, platform: unknown, show: (labels: unknown) => void) => void>(),
  watcherDispose: vi.fn<() => void>(),
  send: vi.fn(),
  execute: vi.fn(),
  warning: vi.fn(),
  register: vi.fn(),
  providerDispose: vi.fn(),
  hostDispose: vi.fn(),
  narrationDispose: vi.fn(),
  connectionDispose: vi.fn(),
  channelDispose: vi.fn(),
  setPage: vi.fn(),
  acceptChunk: vi.fn(),
  showUpdate: vi.fn(),
  showSpeechTransport: vi.fn(),
  receiveNarration: vi.fn(),
  retireFacepalm: vi.fn(),
  disposeFacepalm: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  facepalmOptions: undefined as import('../src/companion_facepalm').CompanionFacepalmOptions | undefined,
  facepalmClient: undefined as { onStatus?: (snapshot: import('@ai-pair/protocol').FacepalmSnapshot) => void } | undefined,
  openSettings: vi.fn().mockResolvedValue(true),
  attach: vi.fn(),
  accept: vi.fn(),
  setPause: vi.fn(),
  interrupt: vi.fn(),
  stopOutput: vi.fn(),
  diagnostic: vi.fn(),
  snapshot: vi.fn(),
  keySet: vi.fn(),
  keyRemove: vi.fn(),
  preview: vi.fn(),
  observation: vi.fn(),
  earlyHostPage: undefined as number | undefined,
  earlyHostPanel: undefined as unknown,
  earlyNarrationPage: undefined as number | undefined,
}));
vi.mock('vscode', () => ({
  Uri: { joinPath: (base: { path: string }, ...parts: string[]) => ({ path: [base.path, ...parts].join('/') }) },
  commands: {
    executeCommand: fake.execute,
    registerCommand: (name: string, callback: (value: unknown) => unknown) => {
      fake.commands.set(name, callback);
      return { dispose() {} };
    },
  },
  window: { registerWebviewViewProvider: fake.register, showWarningMessage: fake.warning },
}));
vi.mock('@ai-pair/protocol', async () => ({
  ...(await vi.importActual<typeof import('@ai-pair/protocol')>('@ai-pair/protocol')),
  CommandChannel: class {
    constructor(options: ChannelOptions) {
      fake.channelOptions = options;
    }
    send = fake.send;
    dispose = fake.channelDispose;
  },
  PanelChunkAssembler: class {
    setPage = fake.setPage;
    accept = fake.acceptChunk;
  },
}));
vi.mock('../../vscode/src/facepalm_client', () => ({
  FacepalmClient: class {
    constructor() {
      fake.facepalmClient = this;
    }
    onStatus?: (snapshot: import('@ai-pair/protocol').FacepalmSnapshot) => void;
    retire = fake.retireFacepalm;
    dispose = fake.disposeFacepalm;
    setEnabled() {}
    refresh() {
      return Promise.resolve();
    }
  },
}));
vi.mock('../../vscode/src/facepalm_settings_launcher', () => ({ openFacepalmSettings: fake.openSettings }));
vi.mock('../../audio-native/src/factory', () => ({ createLocalAudioAdapter: vi.fn(() => ({})) }));
vi.mock('../../vscode/src/diagnostics', () => ({
  Diagnostics: class {
    record = fake.diagnostic;
    snapshot = fake.snapshot;
  },
}));
vi.mock('../../vscode/src/panel', () => ({
  NarrationPanel: class {
    static viewId = 'aiPair.narration';
    constructor(...args: unknown[]) {
      fake.panelArgs(...args);
    }
    useCompanion(value: Routing) {
      fake.routing = value;
    }
    speechReadyPageId() {
      return 7;
    }
    showRemoteUpdate = fake.showUpdate;
    showSpeechTransport = fake.showSpeechTransport;
    showShortcuts = fake.showShortcuts;
  },
}));
vi.mock('../../vscode/src/shortcut_watcher', () => ({
  ShortcutWatcher: class {
    constructor(directory: unknown, platform: unknown, show: (labels: unknown) => void) {
      fake.watcherArgs(directory, platform, show);
    }
    dispose = fake.watcherDispose;
  },
}));
vi.mock('../../vscode/src/shortcut_labels', () => ({ shortcutPlatform: vi.fn(() => 'mac') }));
vi.mock('../../vscode/src/speech_gpu_proof_runner', () => ({
  createGpuProofRunner: (capability: import('../../vscode/src/speech_gpu_client').GpuLaunchCapability) => {
    fake.proofCapability = capability;
    return fake.proof;
  },
}));
vi.mock('../src/speech_host', () => ({
  createSpeechHost: (options: HostOptions) => {
    fake.hostOptions = options;
    fake.earlyHostPage = options.page();
    fake.earlyHostPanel = options.panel();
    return {
      speech: {},
      panelSpeech: { keySet: fake.keySet, keyRemove: fake.keyRemove, preview: fake.preview },
      output: { stopAndWait: fake.stopOutput },
      observation: fake.observation,
      gpuDiagnostics: () => ({ stage: 'idle' }),
      audioDiagnostics: () => ({
        enabled: false,
        provider: 'kokoro',
        keyConfigured: 'unknown',
        voiceConfigured: true,
        output: 'default',
        routeAvailable: 'unknown',
        runtimeReady: 'unknown',
        modelReady: 'unknown',
        lastPlayback: 'unknown',
      }),
      ready: () => Promise.resolve(true),
      dispose: fake.hostDispose,
    };
  },
}));
vi.mock('../src/companion_narration', () => ({
  CompanionNarration: class {
    constructor(options: NarrationOptions) {
      fake.narrationOptions = options;
      fake.earlyNarrationPage = options.page();
    }
    receive = fake.receiveNarration;
    setLocalPause = fake.setPause;
    interruptThen = fake.interrupt;
    dispose = fake.narrationDispose;
  },
}));
vi.mock('../src/local_connection', () => ({
  LocalConnection: class {
    constructor(options: ConnectionOptions) {
      fake.connectionOptions = options;
    }
    attach = fake.attach;
    accept = fake.accept;
    dispose = fake.connectionDispose;
  },
}));

/** Creates a local extension host context. */
function context(): vscode.ExtensionContext {
  return mock<vscode.ExtensionContext>({
    extensionPath: '/trusted',
    subscriptions: [],
    globalStorageUri: mock<vscode.Uri>({ path: '/user/globalStorage/id' }),
  });
}

it('NoOverlap: the real attachment gate waits for the old companion physical retirement', async () => {
  const physicalClose = Promise.withResolvers<void>();
  fake.disposeFacepalm.mockReturnValueOnce(physicalClose.promise).mockResolvedValue(undefined);
  fake.register.mockReturnValue({ dispose: fake.providerDispose });
  fake.send.mockResolvedValue(true);
  fake.execute.mockResolvedValue(undefined);
  activate(context());
  const prepared = fake.commands.get('aiPair.localAudio.prepare')?.({ version: LOCAL_AUDIO_VERSION, epoch: 'old' });
  expect(fake.commands.get('aiPair.localAudio.commit')?.(prepared)).toBe(true);
  expect(fake.register).toHaveBeenCalledTimes(1);
  const stopping = deactivate();
  activate(context());
  const successor = fake.commands.get('aiPair.localAudio.prepare')?.({ version: LOCAL_AUDIO_VERSION, epoch: 'new' });
  const committed = Promise.resolve(fake.commands.get('aiPair.localAudio.commit')?.(successor));
  await Promise.resolve();
  expect(fake.register).toHaveBeenCalledTimes(1);
  physicalClose.resolve();
  await stopping;
  expect(await committed).toBe(true);
  expect(fake.register).toHaveBeenCalledTimes(2);
  await deactivate();
});
