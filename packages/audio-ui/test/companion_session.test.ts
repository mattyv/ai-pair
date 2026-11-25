import { LOCAL_AUDIO_VERSION, MAC_MODIFIERS, type ChannelLoss, type LocalAudioFrame, type LocalPanelAction } from '@ai-pair/protocol';
import { beforeEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';
import { createCompanionSession } from '../src/companion_session';
import { shortcutPlatform } from '../../vscode/src/shortcut_labels';

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
  showFacepalmStatus: vi.fn(),
  receiveNarration: vi.fn(),
  retireFacepalm: vi.fn(),
  localLog: vi.fn<(message: string) => void>(),
  localLogDispose: vi.fn<() => void>(),
  earlyFacepalmStatus: false,
  disposeFacepalm: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  facepalmOptions: undefined as import('../src/companion_facepalm').CompanionFacepalmOptions | undefined,
  facepalmClient: undefined as { onStatus?: (snapshot: import('@ai-pair/protocol').FacepalmSnapshot) => void } | undefined,
  openSettings: vi.fn().mockResolvedValue({ state: 'accepted' }),
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
  commands: { executeCommand: fake.execute },
  window: {
    registerWebviewViewProvider: fake.register,
    showWarningMessage: fake.warning,
    createOutputChannel: () => ({ info: fake.localLog, dispose: fake.localLogDispose }),
  },
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
    snapshot = () => ({ enabled: true, status: 'unchecked' as const, available: true, canOpenSettings: false });
    retire = fake.retireFacepalm;
    setEnabled() {}
    refresh() {
      return Promise.resolve();
    }
  },
}));
vi.mock('../../vscode/src/facepalm_settings_launcher', () => ({
  openFacepalmSettings: fake.openSettings,
  facepalmSettingsWarning: () => 'safe Facepalm warning',
}));
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
    showFacepalmStatus = fake.showFacepalmStatus;
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
vi.mock('../src/companion_facepalm', () => ({
  CompanionFacepalm: class {
    constructor(options: typeof fake.facepalmOptions) {
      fake.facepalmOptions = options;
    }
    accept = vi.fn();
    retire = fake.retireFacepalm;
    dispose = fake.disposeFacepalm;
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
      if (fake.earlyFacepalmStatus) {
        fake.facepalmClient?.onStatus?.({ enabled: true, status: 'unchecked', available: true, canOpenSettings: false });
      }
    }
    attach = fake.attach;
    accept = fake.accept;
    dispose = fake.connectionDispose;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.earlyFacepalmStatus = false;
  fake.routing = undefined;
  fake.connectionOptions = undefined;
  fake.channelOptions = undefined;
  fake.hostOptions = undefined;
  fake.narrationOptions = undefined;
  fake.register.mockReturnValue({ dispose: fake.providerDispose });
  fake.send.mockResolvedValue(undefined);
  fake.execute.mockResolvedValue(undefined);
  fake.interrupt.mockImplementation((run: () => void) => {
    run();
    return Promise.resolve();
  });
  fake.stopOutput.mockResolvedValue(undefined);
  fake.keySet.mockResolvedValue(undefined);
  fake.keyRemove.mockResolvedValue(undefined);
  fake.preview.mockResolvedValue(undefined);
  fake.snapshot.mockReturnValue({ version: 'test', build: 'test-build', events: [] });
});

function session() {
  return createCompanionSession(
    mock<vscode.ExtensionContext>({
      extensionPath: '/trusted',
      subscriptions: [],
      globalStorageUri: mock<vscode.Uri>({ path: '/user/globalStorage/mattyv.ai-pair-local-audio' }),
    }),
    'epoch',
  );
}
function routing(): Routing {
  if (!fake.routing) throw new Error('No routing');
  return fake.routing;
}

it('registers one provider and forwards local commands and diagnostics', async () => {
  const current = session();
  expect(fake.register).toHaveBeenCalledOnce();
  expect(fake.attach).toHaveBeenCalledWith({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'epoch', sequence: 1, type: 'attach' });
  fake.accept.mockReturnValue(true);
  expect(current.accept({ frame: 'test' })).toBe(true);
  await current.keySet();
  await current.keyRemove();
  await current.preview();
  expect(fake.keySet).toHaveBeenCalledOnce();
  expect(fake.keyRemove).toHaveBeenCalledOnce();
  expect(fake.preview).toHaveBeenCalledOnce();
  fake.observation.mockReturnValue({ id: 1, state: 'speaking', started: true });
  expect(current.observation()).toMatchObject({ id: 1 });
  expect(await current.ready('wrong')).toBe(false);
  expect(await current.ready('epoch')).toBe(true);
  expect(current.diagnostics()).toMatchObject({ version: 'test', build: 'test-build' });
  expect(current.gpuDiagnostics()).toEqual({ stage: 'idle' });
  expect(current.audioDiagnostics()).toMatchObject({ enabled: false, provider: 'kokoro' });
  fake.hostOptions?.diagnostic({ kind: 'test' });
  expect(fake.diagnostic).toHaveBeenCalledWith({ kind: 'test' });
  expect(fake.hostOptions?.page()).toBe(7);
  expect(fake.hostOptions?.panel()).toBeDefined();
  await fake.narrationOptions?.stopOutput();
  expect(fake.stopOutput).toHaveBeenCalledOnce();
  expect(fake.narrationOptions?.page()).toBe(7);
  expect(fake.narrationOptions?.observation()).toMatchObject({ id: 1 });
  expect(fake.narrationOptions?.nextSequence()).toBe(1);
  await fake.channelOptions?.send({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'epoch', sequence: 2, type: 'heartbeat' });
  expect(fake.execute).toHaveBeenCalledOnce();
  void current.dispose();
  expect(await current.ready('epoch')).toBe(false);
  expect(fake.providerDispose).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.narrationDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.channelDispose).toHaveBeenCalledOnce();
});

it('forwards panel controls only after local retirement and clears pause reasons', async () => {
  const current = session();
  const panel = routing();
  panel.forward({ type: 'draft', empty: false }, 7);
  panel.forward({ type: 'pause' }, 7);
  panel.forward({ type: 'resume' }, 7);
  expect(fake.setPause.mock.calls).toEqual([[true], [true, 'manual'], [false, 'draft'], [false, 'manual']]);
  fake.send.mockClear();
  fake.setPause.mockClear();
  panel.forward({ type: 'reply', text: 'Hello' }, 7);
  expect(fake.interrupt).toHaveBeenCalledOnce();
  expect(fake.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'panelAction', pageEpoch: 7, action: { type: 'reply', text: 'Hello' } }),
  );
  expect(fake.setPause.mock.calls).toEqual([
    [false, 'draft'],
    [false, 'manual'],
  ]);
  panel.closed(7);
  await Promise.resolve();
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'pageClosed' }, pageEpoch: 7 }));
  expect(fake.setPage).toHaveBeenCalledWith(undefined);
  void current.dispose();
});

it('forwards a plain turn without interrupting or clearing local pause reasons', () => {
  const current = session();
  routing().forward({ type: 'turn' }, 7);
  expect(fake.interrupt).not.toHaveBeenCalled();
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'turn' }, pageEpoch: 7 }));
  expect(fake.setPause).not.toHaveBeenCalled();
  void current.dispose();
});

it.each([{ message: 'Change direction' }, { attach: true }])('retires local speech before forwarding a turn with content', (content) => {
  const current = session();
  routing().forward({ type: 'turn', ...content }, 7);
  expect(fake.interrupt).toHaveBeenCalledOnce();
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'turn', ...content }, pageEpoch: 7 }));
  expect(fake.setPause.mock.calls).toEqual([
    [false, 'draft'],
    [false, 'manual'],
  ]);
  void current.dispose();
});

it('forwards navigator commentary to the workspace', () => {
  const current = session();
  routing().forward({ type: 'navigatorCommentary', value: 'coach' }, 7);
  expect(fake.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'panelAction', pageEpoch: 7, action: { type: 'navigatorCommentary', value: 'coach' } }),
  );
  void current.dispose();
});

it('forwards a reply behavior change to the workspace', () => {
  const current = session();
  routing().forward({ type: 'replyBehavior', value: 'finishAction' }, 7);
  expect(fake.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'panelAction', pageEpoch: 7, action: { type: 'replyBehavior', value: 'finishAction' } }),
  );
  void current.dispose();
});

it('forwards a deferred reply without canceling local narration', () => {
  const current = session();
  const panel = routing();
  panel.forward({ type: 'draft', empty: false }, 7);
  fake.setPause.mockClear();
  panel.forward({ type: 'reply', text: 'Wait', defer: true }, 7);
  expect(fake.interrupt).not.toHaveBeenCalled();
  expect(fake.setPause.mock.calls).toEqual([
    [false, 'draft'],
    [false, 'manual'],
  ]);
  expect(fake.send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'panelAction',
      pageEpoch: 7,
      action: { type: 'reply', text: 'Wait', defer: true },
    }),
  );
  void current.dispose();
});

it('delivers complete panel updates and ignores heartbeats', () => {
  const current = session();
  const common = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, connectionEpoch: 'epoch', sequence: 2 };
  fake.connectionOptions?.receive({ ...common, type: 'heartbeat' });
  expect(fake.receiveNarration).not.toHaveBeenCalled();
  const speak = { ...common, type: 'pause' as const, jobId: 'one', pageEpoch: 7 };
  fake.connectionOptions?.receive(speak);
  expect(fake.receiveNarration).toHaveBeenCalledWith(speak);
  const chunk = { ...common, type: 'panelChunk' as const, pageEpoch: 7, messageId: 1, index: 0, count: 1, data: '{}' };
  fake.acceptChunk.mockReturnValueOnce(undefined).mockReturnValueOnce({ type: 'say', text: 'test' });
  fake.connectionOptions?.receive(chunk);
  expect(fake.showUpdate).not.toHaveBeenCalled();
  fake.connectionOptions?.receive(chunk);
  expect(fake.showUpdate).toHaveBeenCalledWith({ type: 'say', text: 'test' });
  fake.narrationOptions?.send(speak);
  expect(fake.send).toHaveBeenCalledWith(speak);
  void current.dispose();
});

it('waits for old page retirement before forwarding a replacement ready', async () => {
  const retirement = Promise.withResolvers<void>();
  fake.interrupt.mockImplementationOnce((run: () => void) => retirement.promise.then(run));
  const current = session();
  const panel = routing();
  panel.closed(7);
  panel.forward({ type: 'ready' }, 8);
  expect(fake.send).not.toHaveBeenCalled();
  retirement.resolve();
  for (let index = 0; index < 4; index++) await Promise.resolve();
  expect(fake.send.mock.calls.map((call: unknown[]) => call[0])).toMatchObject([
    { type: 'panelAction', pageEpoch: 7, action: { type: 'pageClosed' } },
    { type: 'panelAction', pageEpoch: 8, action: { type: 'ready' } },
  ]);
  void current.dispose();
});

it('warns and suppresses actions when local retirement fails', async () => {
  fake.interrupt.mockRejectedValueOnce(new Error('private'));
  const current = session();
  const panel = routing();
  panel.forward({ type: 'interrupt' }, 7);
  await Promise.resolve();
  expect(fake.send).not.toHaveBeenCalled();
  expect(fake.warning).toHaveBeenCalledWith('AI Pair could not stop local audio; the action was not sent.');
  fake.warning.mockClear();
  fake.interrupt.mockRejectedValueOnce(new Error('private'));
  panel.closed(7);
  panel.forward({ type: 'ready' }, 8);
  for (let index = 0; index < 4; index++) await Promise.resolve();
  expect(fake.warning).toHaveBeenCalledWith('AI Pair could not stop local audio. Reload the window.');
  expect(fake.send).not.toHaveBeenCalled();
  void current.dispose();
});

it('stops locally on connection loss and handles repeated shutdown safely', () => {
  const current = session();
  fake.connectionOptions?.lost();
  expect(fake.showSpeechTransport).toHaveBeenCalledWith(false);
  // The companion's warning names its side and the lease it lost (#115).
  expect(fake.warning).toHaveBeenCalledWith(
    'AI Pair Local Audio lost its workspace connection: no heartbeat from the workspace for 20 seconds. Reload the window to reconnect.',
  );
  fake.channelOptions?.lost('timeout');
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.warning).toHaveBeenCalledOnce();
  void current.dispose();
});

it('replaces the retained page connected status when the command channel is lost', () => {
  session();
  fake.showFacepalmStatus({ enabled: true, status: 'connected', available: true, canOpenSettings: true });
  fake.channelOptions?.lost('closed');
  expect(fake.showFacepalmStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unchecked' }));
});

it('continues retiring all resources if the retained page rejects its final status', async () => {
  const current = session();
  fake.showFacepalmStatus.mockImplementationOnce(() => {
    throw new Error('panel failed');
  });
  await expect(current.dispose()).rejects.toThrow('panel failed');
  expect(fake.disposeFacepalm).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.channelDispose).toHaveBeenCalledOnce();
});

it('drops replacement-ready delivery after the session closes', async () => {
  const current = session();
  routing().forward({ type: 'ready' }, 7);
  void current.dispose();
  await Promise.resolve();
  expect(fake.send).not.toHaveBeenCalled();
});

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) throw new Error(`Missing ${key}`);
  return Reflect.get(value, key);
}
function invoke(value: unknown, ...args: unknown[]): unknown {
  if (typeof value !== 'function') throw new Error('Expected a callback');
  const result: unknown = Reflect.apply(value, undefined, args);
  return result;
}

it('provides safe local-only panel settings and refuses workspace operations', async () => {
  const current = session();
  expect(fake.earlyHostPage).toBeUndefined();
  expect(fake.earlyHostPanel).toBeUndefined();
  expect(fake.earlyNarrationPage).toBeUndefined();
  const args = fake.panelArgs.mock.calls[0];
  expect(args).toBeDefined();
  if (!args) throw new Error('No panel arguments');
  expect(() => invoke(args[0])).toThrow('Workspace operation is unavailable');
  expect(invoke(field(args[1], 'get'))).toBe(1);
  invoke(field(args[1], 'set'), 2);
  expect(invoke(field(args[3], 'current'))).toBeUndefined();
  expect(invoke(field(args[3], 'ref'))).toBeUndefined();
  invoke(args[4]);
  const wiring = args[6];
  expect(() => invoke(field(wiring, 'controller'))).toThrow('Workspace operation is unavailable');
  expect(() => invoke(field(wiring, 'calibration'))).toThrow('Workspace operation is unavailable');
  const starter = field(wiring, 'starter');
  await expect(invoke(field(starter, 'available'))).resolves.toBe(false);
  await expect(invoke(field(starter, 'start'))).resolves.toBeUndefined();
  await expect(invoke(field(wiring, 'copyDiagnostics'))).resolves.toBeUndefined();
  expect(invoke(field(args[7], 'get'))).toBe('newestFirst');
  invoke(field(args[7], 'set'), 'oldestFirst');
  expect(invoke(field(args[9], 'get'))).toBe(false);
  invoke(field(args[9], 'set'), true);
  expect(invoke(args[10])).toBe(false);
  expect(invoke(field(args[11], 'get'))).toBe('typing');
  invoke(field(args[11], 'set'), 'lines');
  expect(invoke(field(args[12], 'get'))).toBe('interrupt');
  invoke(field(args[12], 'set'), 'finishAction');
  expect(invoke(field(args[13], 'get'))).toBe(false);
  invoke(field(args[13], 'set'), true);
  expect(invoke(field(args[13], 'get'))).toBe(false);
  expect(() => invoke(field(args[14], 'get'))).toThrow('Workspace operation is unavailable');
  expect(() => invoke(field(args[14], 'set'), 'coach')).toThrow('Workspace operation is unavailable');
  void current.dispose();
});

it('rejects malformed diagnostics from a local snapshot', () => {
  const current = session();
  fake.snapshot.mockReturnValue({ version: '', build: '', events: [{ private: 'bad' }] });
  expect(current.diagnostics()).toBeUndefined();
  void current.dispose();
});

it('closes local audio and warns when the outbound command channel is lost', () => {
  const current = session();
  fake.channelOptions?.lost('timeout');
  expect(fake.narrationDispose).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.warning).toHaveBeenCalledWith(
    'AI Pair Local Audio lost its workspace connection: the workspace did not answer a message in time. Reload the window to reconnect.',
  );
  void current.dispose();
});

it('supplies the isolated GPU proof runner to the local speech host', async () => {
  const current = session();
  const capability = mock<import('../../vscode/src/speech_gpu_client').GpuLaunchCapability>();
  expect(fake.hostOptions?.enableGpuInference).toBe(true);
  const signal = new AbortController().signal;
  expect(await fake.hostOptions?.gpuProof?.(capability, 'tiny', signal)).toBe('failed');
  expect(fake.proofCapability).toBe(capability);
  expect(fake.proof).toHaveBeenCalledWith('tiny', signal);
  void current.dispose();
});

it('waits for the speech host to reap resources during shutdown', async () => {
  const finished = Promise.withResolvers<void>();
  fake.hostDispose.mockReturnValueOnce(finished.promise);
  const current = session();
  let disposed = false;
  const pending = Promise.resolve(current.dispose()).then(() => {
    disposed = true;
  });
  await Promise.resolve();
  expect(disposed).toBe(false);
  finished.resolve();
  await pending;
  expect(disposed).toBe(true);
});

it("Converges: reads this machine's keybindings.json for the page it owns, and stops on dispose", () => {
  const current = session();
  const call = fake.watcherArgs.mock.calls[0];
  if (call === undefined) throw new Error('No watcher');
  const [directory, platform, show] = call;
  expect(directory).toEqual({ path: '/user/globalStorage/mattyv.ai-pair-local-audio/../..' });
  expect(vi.mocked(shortcutPlatform)).toHaveBeenCalledWith(process.platform);
  expect(platform).toBe('mac');
  show({ pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q` });
  expect(fake.showShortcuts).toHaveBeenCalledWith({ pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q` });
  void current.dispose();
  expect(fake.watcherDispose).toHaveBeenCalledOnce();
});

it('routes Facepalm commands to the local owner', () => {
  const current = session();
  const frame: LocalAudioFrame = {
    version: LOCAL_AUDIO_VERSION,
    connectionEpoch: 'epoch',
    sequence: 2,
    type: 'facepalmRefresh',
    pageEpoch: 7,
    requestId: 1,
  };
  fake.connectionOptions?.receive(frame);
  expect(fake.receiveNarration).not.toHaveBeenCalledWith(frame);
  void current.dispose();
});

it('retires local Facepalm before a replacement page is ready', () => {
  const current = session();
  routing().forward({ type: 'ready' }, 7);
  routing().forward({ type: 'ready' }, 8);
  expect(fake.retireFacepalm).toHaveBeenCalledOnce();
  routing().closed(8);
  void current.dispose();
});

it('connects local Facepalm status, page, settings and ordered result output', async () => {
  const current = session();
  const frame: LocalAudioFrame = {
    version: LOCAL_AUDIO_VERSION,
    connectionEpoch: 'epoch',
    sequence: 4,
    type: 'facepalmRefresh',
    pageEpoch: 7,
    requestId: 1,
  };
  expect(fake.facepalmOptions?.page()).toBe(7);
  fake.facepalmOptions?.diagnostic?.('Facepalm settings request received.');
  expect(fake.localLog).toHaveBeenCalledWith('Facepalm settings request received.');
  fake.facepalmOptions?.send(frame);
  expect(fake.send).toHaveBeenCalledWith(frame);
  fake.openSettings.mockResolvedValueOnce({ state: 'failed', reason: 'display' });
  await expect(fake.facepalmOptions?.openSettings(() => {})).resolves.toEqual({ state: 'failed', reason: 'display' });
  await expect(fake.facepalmOptions?.openSettings(() => {})).resolves.toEqual({ state: 'accepted' });
  const snapshot = { enabled: true, status: 'idle' as const, available: true, canOpenSettings: true };
  fake.facepalmClient?.onStatus?.(snapshot);
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'facepalmStatus', snapshot }));
  await current.dispose();
});

it('NoOverlap: shutdown waits for physical Facepalm close and tolerates reentrant channel loss', async () => {
  const close = Promise.withResolvers<void>();
  fake.disposeFacepalm.mockImplementationOnce(() => {
    fake.channelOptions?.lost('closed');
    return close.promise;
  });
  const current = session();
  let done = false;
  const stopped = current.dispose().then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(fake.disposeFacepalm).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(done).toBe(false);
  close.resolve();
  await stopped;
  expect(done).toBe(true);
});

it('reports synchronous retirement failure through the shutdown promise', async () => {
  fake.disposeFacepalm.mockImplementationOnce(() => {
    throw new Error('retirement failed');
  });
  const current = session();
  await expect(current.dispose()).rejects.toThrow('retirement failed');
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.channelDispose).toHaveBeenCalledOnce();
});

it('waits for both resources and reports asynchronous retirement failure', async () => {
  const close = Promise.withResolvers<void>();
  fake.disposeFacepalm.mockReturnValueOnce(close.promise);
  fake.hostDispose.mockRejectedValueOnce(new Error('speech failed'));
  const current = session();
  let done = false;
  const stopped = current.dispose().catch((error: unknown) => {
    done = true;
    throw error;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  close.resolve();
  await expect(stopped).rejects.toThrow('speech failed');
});

it('reports a startup status before a page exists without inventing a page identity', async () => {
  fake.earlyFacepalmStatus = true;
  const current = session();
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'facepalmStatus', pageEpoch: 0 }));
  await current.dispose();
});

it('retires its log once on channel loss and still disposes other resources if the log fails', async () => {
  fake.localLogDispose.mockImplementationOnce(() => {
    throw new Error('log failure');
  });
  const current = session();
  fake.channelOptions?.lost('closed');
  await expect(current.dispose()).resolves.toBeUndefined();
  await expect(current.dispose()).resolves.toBeUndefined();
  expect(fake.localLogDispose).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.channelDispose).toHaveBeenCalledOnce();
});

it('reports disconnected Facepalm controls instead of silently dropping the action', async () => {
  const current = session();
  fake.channelOptions?.lost('closed');
  fake.warning.mockClear();
  routing().forward({ type: 'facepalmOpenSettings' }, 7);
  routing().forward({ type: 'facepalmRefresh' }, 7);
  routing().forward({ type: 'facepalmEnabled', value: false }, 7);
  routing().forward({ type: 'pause' }, 7);
  expect(fake.warning).toHaveBeenCalledTimes(3);
  expect(fake.warning).toHaveBeenCalledWith('AI Pair Local Audio is disconnected. Reload the window to use Facepalm.');
  await current.dispose();
});
