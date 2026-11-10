import { beforeEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';
import type { LocalAudioFrame, LocalPanelAction } from '@ai-pair/protocol';
import { createCompanionSession } from '../src/companion_session';

interface Routing {
  forward(action: LocalPanelAction, page: number): void;
  closed(page: number): void;
}
interface ConnectionOptions {
  lost(): void;
  receive(frame: LocalAudioFrame): void;
}
interface ChannelOptions {
  lost(): void;
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
  commands: { executeCommand: fake.execute },
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
  },
}));
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

beforeEach(() => {
  vi.clearAllMocks();
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
  return createCompanionSession(mock<vscode.ExtensionContext>({ extensionPath: '/trusted', subscriptions: [] }), 'epoch');
}
function routing(): Routing {
  if (!fake.routing) throw new Error('No routing');
  return fake.routing;
}

it('registers one provider and forwards local commands and diagnostics', async () => {
  const current = session();
  expect(fake.register).toHaveBeenCalledOnce();
  expect(fake.attach).toHaveBeenCalledWith({ version: 2, connectionEpoch: 'epoch', sequence: 1, type: 'attach' });
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
  await fake.channelOptions?.send({ version: 2, connectionEpoch: 'epoch', sequence: 2, type: 'heartbeat' });
  expect(fake.execute).toHaveBeenCalledOnce();
  current.dispose();
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
  current.dispose();
});

it('forwards a reply behavior change to the workspace', () => {
  const current = session();
  routing().forward({ type: 'replyBehavior', value: 'finishAction' }, 7);
  expect(fake.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'panelAction', pageEpoch: 7, action: { type: 'replyBehavior', value: 'finishAction' } }),
  );
  current.dispose();
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
  current.dispose();
});

it('delivers complete panel updates and ignores heartbeats', () => {
  const current = session();
  const common = { version: 2 as const, connectionEpoch: 'epoch', sequence: 2 };
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
  current.dispose();
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
  current.dispose();
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
  current.dispose();
});

it('stops locally on connection loss and handles repeated shutdown safely', () => {
  const current = session();
  fake.connectionOptions?.lost();
  expect(fake.showSpeechTransport).toHaveBeenCalledWith(false);
  expect(fake.warning).toHaveBeenCalledWith('AI Pair lost its local audio connection. Reload the window to reconnect.');
  fake.channelOptions?.lost();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.warning).toHaveBeenCalledOnce();
  current.dispose();
});

it('drops replacement-ready delivery after the session closes', async () => {
  const current = session();
  routing().forward({ type: 'ready' }, 7);
  current.dispose();
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
  current.dispose();
});

it('rejects malformed diagnostics from a local snapshot', () => {
  const current = session();
  fake.snapshot.mockReturnValue({ version: '', build: '', events: [{ private: 'bad' }] });
  expect(current.diagnostics()).toBeUndefined();
  current.dispose();
});

it('closes local audio and warns when the outbound command channel is lost', () => {
  const current = session();
  fake.channelOptions?.lost();
  expect(fake.narrationDispose).toHaveBeenCalledOnce();
  expect(fake.hostDispose).toHaveBeenCalledOnce();
  expect(fake.connectionDispose).toHaveBeenCalledOnce();
  expect(fake.warning).toHaveBeenCalledWith('AI Pair lost its local audio connection. Reload the window to reconnect.');
  current.dispose();
});

it('supplies the isolated GPU proof runner to the local speech host', async () => {
  const current = session();
  const capability = mock<import('../../vscode/src/speech_gpu_client').GpuLaunchCapability>();
  expect(fake.hostOptions?.enableGpuInference).toBe(true);
  expect(await fake.hostOptions?.gpuProof?.(capability, 'tiny')).toBe('failed');
  expect(fake.proofCapability).toBe(capability);
  expect(fake.proof).toHaveBeenCalledWith('tiny');
  current.dispose();
});
