import { beforeEach, expect, it, vi } from 'vitest';
const tempoPaths = vi.hoisted(() => [] as string[]);
vi.mock('../../vscode/src/speech_tempo_client', () => ({
  SpeechTempoClient: class {
    constructor(path: string) {
      tempoPaths.push(path);
    }
    dispose = vi.fn().mockResolvedValue(undefined);
  },
}));
import type * as vscode from 'vscode';
import type { AudioAdapter } from '../../audio-native/src';
import type { SpeechDiagnosticEvent } from '../../vscode/src/diagnostics';
import { createSpeechHost } from '../src/speech_host';

const fakes = vi.hoisted(() => ({
  gpuClientFactory: vi.fn(),
  gpuSlotBusy: vi.fn<() => boolean>().mockReturnValue(false),
  retireIdleGpu: vi.fn<() => void>(),
  gpuFlowResult: vi
    .fn<() => Promise<import('../../vscode/src/speech_compute_types').GpuCheck>>()
    .mockResolvedValue({ phase: 'unavailable', reason: 'probe_failed' }),
  gpuFlow: undefined as import('../../vscode/src/speech_gpu_setup_flow').GpuSetupFlowOptions | undefined,
  gpuPreflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
  gpuIssue: vi.fn().mockResolvedValue({ check: { phase: 'unavailable', reason: 'probe_failed' } }),
  gpuInstalled: vi.fn().mockResolvedValue('/gpu'),
  gpuDownload: vi.fn().mockResolvedValue('/gpu'),
  speechOptions: undefined as
    | Pick<
        import('../../vscode/src/speech_service').SpeechServiceOptions,
        'computeMode' | 'actualBackend' | 'gpuCheck' | 'gpuCapability' | 'createGpu' | 'gpuExternalBusy'
      >
    | undefined,
  cloudDiagnostic: undefined as ((reason: 'auth') => void) | undefined,
  readiness: vi.fn<(options: import('../../vscode/src/speech_readiness').SpeechReadiness) => Promise<boolean>>().mockResolvedValue(true),
  platform: vi.fn<() => import('../../vscode/src/speech_platform').SpeechPlatformResult>().mockReturnValue({ supported: true }),
  config: new Map<string, unknown>(),
  update: vi.fn().mockResolvedValue(undefined),
  choice: vi.fn<() => import('../../vscode/src/speech_output_types').OutputChoice>().mockReturnValue({ kind: 'default' }),
  ready: vi.fn().mockReturnValue(true),
  secretChanged: undefined as ((event: { key: string }) => void) | undefined,
  credentialInvalidate: vi.fn(),
  errorMessage: vi.fn(),
  uiKind: 1,
  showInputBox: vi.fn(),
  readKey: undefined as (() => Promise<string | undefined>) | undefined,
  catalogPublish: undefined as ((value: import('../../vscode/src/speech_catalog').CatalogView) => void) | undefined,
  preferencesWiring: undefined as import('../../vscode/src/speech_output_preferences').OutputPreferenceWiring | undefined,
  outputWiring: undefined as import('../src/companion_output').CompanionOutputOptions | undefined,
  credentialChanged: undefined as (() => void) | undefined,
  credentialPrompt: undefined as (() => PromiseLike<string | undefined>) | undefined,
  configChanged: undefined as ((event: { affectsConfiguration(key: string): boolean }) => void) | undefined,
  cancel: vi.fn(),
  invalidateCloud: vi.fn(),
  audioEvent: vi.fn(),
  dispose: vi.fn(),
  preview: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn(),
  contains: vi.fn().mockReturnValue(false),
  load: vi.fn(),
  read: vi.fn(),
  hasKey: vi.fn().mockResolvedValue(false),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  supersede: vi.fn(),
  outputDispose: vi.fn(),
  stopAndWait: vi.fn().mockResolvedValue(undefined),
  runtime: vi.fn().mockResolvedValue(false),
  installed: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../vscode/src/speech_compute', () => ({
  SpeechCompute: class {
    private value: import('../../vscode/src/speech_compute_types').SpeechComputeState;
    constructor(
      requested: unknown,
      private readonly probe: (
        progress: (value: import('../../vscode/src/speech_compute_types').GpuCheckProgress) => void,
      ) => Promise<import('../../vscode/src/speech_compute_types').GpuCheck>,
      private readonly changed: (value: import('../../vscode/src/speech_compute_types').SpeechComputeState) => void,
    ) {
      this.value = {
        requestedMode: requested === 'auto' || requested === 'gpu' ? requested : 'cpu',
        actualBackend: 'none',
        gpuCheck: { phase: 'idle' },
      };
    }
    state(): import('../../vscode/src/speech_compute_types').SpeechComputeState {
      return this.value;
    }
    select(requestedMode: import('../../vscode/src/speech_compute_types').SpeechComputeMode): void {
      this.value = { ...this.value, requestedMode };
      this.changed(this.value);
    }
    actual(actualBackend: import('../../vscode/src/speech_compute_types').SpeechComputeBackend): void {
      this.value = { ...this.value, actualBackend };
      this.changed(this.value);
    }
    reportUnavailable(reason: import('../../vscode/src/speech_compute_types').GpuUnavailableReason): void {
      this.value = { ...this.value, gpuCheck: { phase: 'unavailable', reason } };
      this.changed(this.value);
    }
    async check(): Promise<void> {
      this.value = { ...this.value, gpuCheck: await this.probe(() => {}) };
      this.changed(this.value);
    }
  },
}));
vi.mock('../../vscode/src/speech_gpu_client', () => ({ createGpuSynthesisClient: fakes.gpuClientFactory }));
vi.mock('../../vscode/src/speech_gpu_host_binding', () => ({
  createGpuHostBinding: () => ({ preflight: fakes.gpuPreflight, issue: fakes.gpuIssue }),
}));
vi.mock('../../vscode/src/speech_gpu_model', () => ({ installedGpuModel: fakes.gpuInstalled, setupGpuModel: fakes.gpuDownload }));
vi.mock('../../vscode/src/speech_gpu_setup_flow', () => ({
  setupGpuFlow: (options: import('../../vscode/src/speech_gpu_setup_flow').GpuSetupFlowOptions) => {
    fakes.gpuFlow = options;
    return fakes.gpuFlowResult();
  },
}));
vi.mock('../../vscode/src/speech_readiness', () => ({ speechReady: fakes.readiness }));
vi.mock('../../vscode/src/speech_platform', () => ({ localSpeechPlatform: fakes.platform }));
vi.mock('vscode', () => ({
  env: {
    get uiKind() {
      return fakes.uiKind;
    },
  },
  UIKind: { Desktop: 1 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => fakes.config.get(key),
      inspect: (key: string) => ({ globalValue: fakes.config.get(key) }),
      update: fakes.update,
    }),
    onDidChangeConfiguration: (callback: typeof fakes.configChanged) => {
      fakes.configChanged = callback;
      return { dispose: vi.fn() };
    },
  },
  window: { showInputBox: fakes.showInputBox, showErrorMessage: fakes.errorMessage },
}));
vi.mock('../../vscode/src/speech_service', () => ({
  SpeechService: class {
    constructor(
      options: { cloudDiagnostic?: (reason: 'auth') => void } & Pick<
        import('../../vscode/src/speech_service').SpeechServiceOptions,
        'computeMode' | 'actualBackend' | 'gpuCheck' | 'gpuCapability' | 'createGpu' | 'gpuExternalBusy'
      >,
    ) {
      fakes.cloudDiagnostic = options.cloudDiagnostic;
      fakes.speechOptions = options;
    }
    gpuSlotBusy = fakes.gpuSlotBusy;
    retireIdleGpu = fakes.retireIdleGpu;
    cancel = fakes.cancel;
    invalidateCloud = fakes.invalidateCloud;
    audioEvent = fakes.audioEvent;
    dispose = fakes.dispose;
    preview = fakes.preview;
    pageClosed = vi.fn();
  },
}));
vi.mock('../../vscode/src/speech_catalog', () => ({
  SpeechCatalog: class {
    constructor(client: unknown, publish: NonNullable<typeof fakes.catalogPublish>) {
      void client;
      fakes.catalogPublish = publish;
    }
    invalidate = fakes.invalidate;
    contains = fakes.contains;
    load = fakes.load;
  },
}));
vi.mock('../../vscode/src/speech_credentials', () => ({
  SpeechCredentials: class {
    constructor(
      storage: unknown,
      prompt: NonNullable<typeof fakes.credentialPrompt>,
      changed: NonNullable<typeof fakes.credentialChanged>,
    ) {
      void storage;
      fakes.credentialPrompt = prompt;
      fakes.credentialChanged = changed;
    }
    read = fakes.read;
    hasKey = fakes.hasKey;
    set = fakes.set;
    remove = fakes.remove;
    supersede = fakes.supersede;
    invalidate = fakes.credentialInvalidate;
  },
}));
vi.mock('../../vscode/src/speech_elevenlabs', () => ({
  ElevenLabsClient: class {
    readonly client = true;
    constructor(read: NonNullable<typeof fakes.readKey>) {
      fakes.readKey = read;
    }
  },
}));
vi.mock('../../vscode/src/speech_output_preferences', () => ({
  SpeechOutputPreferences: class {
    constructor(wiring: NonNullable<typeof fakes.preferencesWiring>) {
      fakes.preferencesWiring = wiring;
    }
    choice = fakes.choice;
    view = vi.fn();
    ready = fakes.ready;
    refresh = vi.fn().mockResolvedValue(undefined);
    choose = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: fakes.runtime }));
vi.mock('../../vscode/src/speech_setup', () => ({
  installedSpeechModel: fakes.installed,
  speechModelStatus: vi
    .fn()
    .mockResolvedValue({ path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' }),
  setupSpeech: fakes.setup,
}));
vi.mock('../src/companion_output', () => ({
  CompanionOutput: class {
    constructor(wiring: NonNullable<typeof fakes.outputWiring>) {
      fakes.outputWiring = wiring;
    }
    dispose = fakes.outputDispose;
    stopAndWait = fakes.stopAndWait;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.platform.mockReturnValue({ supported: true });
  fakes.config.clear();
  fakes.uiKind = 1;
  fakes.update.mockReset().mockResolvedValue(undefined);
  fakes.choice.mockReturnValue({ kind: 'default' });
  fakes.ready.mockReturnValue(true);
  fakes.runtime.mockReset().mockResolvedValue(false);
  fakes.hasKey.mockReset().mockResolvedValue(false);
  fakes.contains.mockReturnValue(false);
});

/** Creates a local host with typed isolated collaborators. */
function harness(
  capabilities?: () => Promise<import('../../audio-native/src').AudioCapabilities>,
  gpuProof?: import('../../vscode/src/speech_gpu_binding').GpuBindingDependencies['proof'],
  enableGpuInference = false,
) {
  // The solitary fixture implements the VS Code context methods this module calls.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '/extension',
    globalStorageUri: { fsPath: '/storage' },
    secrets: {
      onDidChange: (callback: typeof fakes.secretChanged) => {
        fakes.secretChanged = callback;
        return { dispose: vi.fn() };
      },
    },
    globalState: { get: () => undefined, update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
  const list = vi.fn<() => Promise<Array<import('../../audio-native/src').AudioDevice>>>().mockResolvedValue([]);
  const adapter: AudioAdapter = {
    capabilities:
      capabilities ??
      vi.fn().mockResolvedValue({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true }),
    list,
    admit: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    onEvent: vi.fn(),
  };
  const panel = {
    showSpeechKeyStatus: vi.fn(),
    showSpeechOutputCatalog: vi.fn(),
    showSpeechCatalog: vi.fn(),
    showSpeechSettings: vi.fn(),
    showSpeechComputeState: vi.fn(),
    showSpeechStatus: vi.fn(),
    refreshSpeechSupport: vi.fn(),
  };
  const diagnostic = vi.fn<(event: SpeechDiagnosticEvent) => void>();
  const host = createSpeechHost({
    context,
    adapter,
    connectionEpoch: 'epoch',
    ...(gpuProof === undefined ? {} : { gpuProof }),
    enableGpuInference,
    page: () => 1,
    panel: () => panel,
    diagnostic,
  });
  return { host, adapter, panel, list, diagnostic };
}

it('uses local settings and credentials through panel callbacks', async () => {
  const { host, panel } = harness();
  expect(host.panelSpeech.settings.get().enabled).toBe(false);
  fakes.catalogPublish?.({ voices: [], more: false, loading: true, error: false });
  fakes.catalogPublish?.({ voices: [], more: false, loading: false, error: false });
  fakes.catalogPublish?.({ voices: [], more: false, loading: false, error: false, reset: true });
  fakes.outputWiring?.event({ id: 1, pageId: 1, event: 'started' });
  fakes.outputWiring?.status(1, 'speaking');
  expect(panel.showSpeechStatus).toHaveBeenCalled();
  expect(fakes.outputWiring?.choice()).toEqual({ kind: 'default' });
  await fakes.preferencesWiring?.write({ kind: 'default' });
  fakes.preferencesWiring?.stop();
  await fakes.preferencesWiring?.discover();
  fakes.credentialChanged?.();
  await fakes.credentialPrompt?.();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  const setting = { ...host.panelSpeech.settings.get(), enabled: true, provider: 'elevenlabs' as const, elevenLabsVoice: 'voice' };
  host.panelSpeech.settings.set(setting);
  expect(host.panelSpeech.settings.get()).toEqual(setting);
  await vi.waitFor(() => {
    expect(panel.showSpeechSettings).toHaveBeenCalled();
  });
  expect(fakes.cancel).toHaveBeenCalled();
  expect(await host.panelSpeech.modelStatus()).toMatchObject({ download: 'missing' });
  host.panelSpeech.outputView();
  host.panelSpeech.outputReady();
  host.panelSpeech.outputRefresh();
  host.panelSpeech.outputSelect({ kind: 'default' });
  host.panelSpeech.outputRetired(1, 1);
  host.panelSpeech.outputPageRetired(1);
  host.panelSpeech.loadVoices(false);
  expect(fakes.load).toHaveBeenCalledWith(false);
  expect(host.panelSpeech.validCloudVoice('voice')).toBe(false);
  expect(host.panelSpeech.cloudSupported()).toBe(true);
  expect(await host.panelSpeech.installed()).toBe(false);
  await host.panelSpeech.setup();
  host.panelSpeech.event({ id: 1, pageId: 1, event: 'started' });
  host.panelSpeech.pageClosed(1);
  expect(fakes.audioEvent).toHaveBeenCalled();
  await host.panelSpeech.keySet();
  expect(fakes.set).toHaveBeenCalledOnce();
  await host.panelSpeech.keyRemove();
  expect(fakes.remove).toHaveBeenCalledOnce();
  await host.panelSpeech.preview();
  expect(fakes.preview).toHaveBeenCalledOnce();
  host.panelSpeech.stop();
  expect(fakes.cancel).toHaveBeenCalled();
  host.dispose();
  expect(fakes.dispose).toHaveBeenCalledOnce();
  expect(fakes.outputDispose).toHaveBeenCalledOnce();
});

it('keeps the latest setting while serialized writes are pending and rolls back a failed latest save', async () => {
  const { host, panel } = harness();
  const pending = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(pending.promise);
  const initial = host.panelSpeech.settings.get();
  const first = { ...initial, enabled: true };
  const second = { ...first, provider: 'elevenlabs' as const, elevenLabsVoice: 'voice' };
  host.panelSpeech.settings.set(first);
  host.panelSpeech.settings.set(second);
  expect(host.panelSpeech.settings.get()).toEqual(second);
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(1);
  });
  pending.resolve();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(14);
  });
  expect(panel.showSpeechSettings).toHaveBeenCalledTimes(1);
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.settings.set(first);
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledWith('Could not save speech settings.');
  });
  expect(host.panelSpeech.settings.get()).toEqual(initial);
  expect(fakes.cancel).toHaveBeenCalled();
  expect(fakes.invalidate).toHaveBeenCalled();
  host.dispose();
});

it('invalidates pending voice and speech when the local key changes', async () => {
  const { host, panel } = harness();
  fakes.config.set('speech.elevenLabsVoice', 'old_voice');
  fakes.credentialChanged?.();
  expect(fakes.invalidateCloud).toHaveBeenCalledOnce();
  expect(host.panelSpeech.settings.get().elevenLabsVoice).toBe('');
  await vi.waitFor(() => {
    expect(panel.showSpeechSettings).toHaveBeenCalled();
  });
  fakes.secretChanged?.({ key: 'unrelated' });
  expect(fakes.credentialInvalidate).not.toHaveBeenCalled();
  fakes.secretChanged?.({ key: 'aiPair.elevenLabs.apiKey' });
  expect(fakes.credentialInvalidate).toHaveBeenCalledOnce();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  host.dispose();
});

it('cancels local speech when external settings disable it or switch provider', () => {
  fakes.config.set('speech.enabled', true);
  const { host, panel } = harness();
  fakes.config.set('speech.enabled', false);
  fakes.configChanged?.({ affectsConfiguration: () => false });
  expect(fakes.cancel).not.toHaveBeenCalled();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.cancel).toHaveBeenCalledOnce();
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.supersede).toHaveBeenCalled();
  expect(fakes.invalidate).toHaveBeenCalled();
  expect(panel.showSpeechSettings).toHaveBeenCalledTimes(2);
  host.dispose();
});

it('drops asynchronous key, capability and runtime results after disposal', async () => {
  const runtime = Promise.withResolvers<boolean>();
  const key = Promise.withResolvers<boolean>();
  const capability = Promise.withResolvers<import('../../audio-native/src').AudioCapabilities>();
  fakes.runtime.mockReturnValueOnce(runtime.promise);
  fakes.hasKey.mockReturnValueOnce(key.promise);
  const { host, panel } = harness(() => capability.promise);
  host.panelSpeech.keyRefresh();
  host.dispose();
  runtime.resolve(true);
  key.resolve(true);
  capability.resolve({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  await Promise.resolve();
  expect(panel.refreshSpeechSupport).not.toHaveBeenCalled();
  expect(panel.showSpeechKeyStatus).not.toHaveBeenCalled();
});

it('only admits the selected backend and never substitutes a missing route', async () => {
  const { host, list } = harness();
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'coreaudio', name: 'headset' });
  expect(host.panelSpeech.outputReady()).toBe(false);
  expect(fakes.outputWiring?.choice()).toEqual({ kind: 'device', id: 'headset' });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  fakes.ready.mockReturnValue(false);
  expect(host.panelSpeech.outputReady()).toBe(false);
  fakes.ready.mockReturnValue(true);
  expect(host.panelSpeech.outputReady()).toBe(true);
  list.mockResolvedValueOnce([{ id: 'headset', label: 'Headset' }]);
  expect(await fakes.preferencesWiring?.discover()).toEqual({
    supported: true,
    devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'headset' }, label: 'Headset', available: true }],
  });
  fakes.preferencesWiring?.changed({ supported: true, devices: [], selected: { kind: 'default' } });
  host.dispose();
});

it('reports unavailable output and key failures without exposing their details', async () => {
  const unavailable = { backend: 'unknown', location: 'ui' as const, defaultOutput: false, deviceSelection: false, pauseResume: false };
  const { host, panel } = harness(() => Promise.resolve(unavailable));
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
  fakes.hasKey.mockRejectedValueOnce(new Error('secret'));
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  fakes.stopAndWait.mockRejectedValueOnce(new Error('private'));
  fakes.preferencesWiring?.stop();
  expect(fakes.cancel).toHaveBeenCalled();
  host.dispose();
});

it('reports catalog outcomes using only fixed diagnostic reasons', () => {
  const { host } = harness();
  const publish = fakes.catalogPublish;
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [], more: false, loading: false, error: true });
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [], more: false, loading: false, error: true, errorKind: 'network' });
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [{ id: 'voice', name: 'Voice' }], more: false, loading: false, error: false });
  host.dispose();
  publish?.({ voices: [], more: false, loading: false, error: false });
});

it('reads local settings, previews installed models, and keeps cloud unavailable in web hosts', async () => {
  fakes.uiKind = 2;
  fakes.config.set('speech.enabled', true);
  fakes.config.set('speech.voice', 'am_michael');
  fakes.config.set('speech.speed', 1.25);
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.config.set('speech.elevenLabsVoice', 'voice');
  fakes.config.set('speech.elevenLabsSpeed', 1.1);
  fakes.installed.mockResolvedValueOnce('/model');
  const { host, panel } = harness();
  expect(host.panelSpeech.settings.get()).toEqual({
    enabled: true,
    voice: 'am_michael',
    speed: 1.25,
    provider: 'elevenlabs',
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1.1,
    listeningSpeed: 1,
  });
  expect(host.panelSpeech.cloudSupported()).toBe(false);
  expect(host.panelSpeech.supported()).toBe(false);
  expect(await host.panelSpeech.installed()).toBe(true);
  fakes.hasKey.mockResolvedValueOnce(true);
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  await fakes.readKey?.();
  expect(fakes.read).toHaveBeenCalled();
  host.dispose();
});

it('restores a newly validated voice and ignores a superseded failed save', async () => {
  const { host, panel } = harness();
  fakes.credentialChanged?.();
  await vi.waitFor(() => {
    expect(panel.showSpeechSettings).toHaveBeenCalled();
  });
  const blocked = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(blocked.promise);
  const first = { ...host.panelSpeech.settings.get(), enabled: true };
  host.panelSpeech.settings.set(first);
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(8);
  });
  fakes.contains.mockReturnValue(true);
  const second = { ...first, elevenLabsVoice: 'new_voice' };
  host.panelSpeech.settings.set(second);
  blocked.reject(new Error('old failure'));
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(15);
  });
  expect(fakes.errorMessage).not.toHaveBeenCalled();
  fakes.config.set('speech.elevenLabsVoice', 'new_voice');
  await vi.waitFor(() => {
    expect(host.panelSpeech.settings.get().elevenLabsVoice).toBe('new_voice');
  });
  host.dispose();
});

it('handles unsupported adapters and superseded capability discovery', async () => {
  const first = Promise.withResolvers<import('../../audio-native/src').AudioCapabilities>();
  const capabilities = vi
    .fn<() => Promise<import('../../audio-native/src').AudioCapabilities>>()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ backend: 'unknown', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: false })
    .mockResolvedValueOnce({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: false, pauseResume: false });
  const { host } = harness(capabilities);
  const stale = fakes.preferencesWiring?.discover();
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
  first.resolve({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  await stale;
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: true, devices: [] });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  expect(host.panelSpeech.outputReady()).toBe(false);
  host.dispose();
  fakes.preferencesWiring?.changed({ supported: false, devices: [], selected: { kind: 'default' } });
  fakes.outputWiring?.status(1, 'idle');
});

it('supports a ready local runtime and suppresses stale key failures', async () => {
  const key = Promise.withResolvers<boolean>();
  fakes.runtime.mockResolvedValueOnce(true);
  fakes.hasKey.mockReturnValueOnce(key.promise).mockResolvedValueOnce(true);
  const { host, panel } = harness();
  await vi.waitFor(() => {
    expect(host.panelSpeech.supported()).toBe(true);
  });
  host.panelSpeech.keyRefresh();
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  key.reject(new Error('late'));
  await Promise.resolve();
  expect(panel.showSpeechKeyStatus).toHaveBeenCalledTimes(1);
  host.dispose();
});

it('reports unavailable process evidence without exposing host details', async () => {
  fakes.platform.mockReturnValue({ supported: false, reason: 'libc_report_failed' });
  const host = harness();
  expect(host.host.panelSpeech.supported()).toBe(false);
  await vi.waitFor(() => {
    expect(host.diagnostic).toHaveBeenCalledWith({
      kind: 'speech',
      event: 'capability',
      phase: 'blocked',
      provider: 'kokoro',
      reason: 'libc_report_failed',
    });
  });
  host.host.dispose();
});

it('cancels on disable without invalidating the unchanged provider', () => {
  fakes.config.set('speech.enabled', true);
  const { host } = harness();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.cancel).not.toHaveBeenCalled();
  host.panelSpeech.settings.set({ ...host.panelSpeech.settings.get(), enabled: false });
  expect(fakes.cancel).toHaveBeenCalledOnce();
  expect(fakes.supersede).not.toHaveBeenCalled();
  host.dispose();
});

it('exposes only bounded local speech lifecycle facts for integration observation', () => {
  const { host } = harness();
  expect(host.observation()).toBeUndefined();
  fakes.outputWiring?.status(7, 'preparing', 'private text');
  expect(host.observation()).toEqual({ id: 7, state: 'preparing', started: false });
  fakes.outputWiring?.status(7, 'speaking');
  fakes.audioEvent.mockReturnValueOnce('ended');
  fakes.outputWiring?.event({ id: 7, pageId: 1, event: 'ended' });
  expect(host.observation()).toEqual({ id: 7, state: 'speaking', started: true, terminal: 'ended' });
  expect(JSON.stringify(host.observation())).not.toContain('private text');
  host.dispose();
});

it('records local worker and preview outcomes without sensitive content', async () => {
  const { host, diagnostic } = harness();
  fakes.outputWiring?.localDiagnostic?.('failed', 'worker_module');
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(9, 'preparing');
    return Promise.resolve();
  });
  const preview = host.panelSpeech.preview();
  fakes.outputWiring?.status(9, 'speaking');
  await preview;
  expect(diagnostic).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'runtime',
    provider: 'kokoro',
    phase: 'failed',
    reason: 'worker_module',
  });
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'ready' });
  host.dispose();
});

it('records preview failure and ignores an older preview settlement', async () => {
  const { host, diagnostic } = harness();
  fakes.outputWiring?.localDiagnostic?.('ready');
  fakes.outputWiring?.status(1, 'preparing');
  fakes.outputWiring?.status(1, 'idle');
  const older = Promise.withResolvers<void>();
  const newer = Promise.withResolvers<void>();
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(2, 'preparing');
    return older.promise;
  });
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(3, 'preparing');
    return newer.promise;
  });
  const first = host.panelSpeech.preview();
  const second = host.panelSpeech.preview();
  older.resolve();
  await first;
  fakes.outputWiring?.status(3, 'unavailable', 'private');
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'failed', reason: 'unknown' });
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'ready' });
  newer.resolve();
  await second;
  host.dispose();
});

it('defaults invalid listening speed and persists it independently of synthesis speed', async () => {
  const { host } = harness();
  expect(host.panelSpeech.settings.get()).toMatchObject({ listeningSpeed: 1, speed: 1, elevenLabsSpeed: 1 });
  fakes.config.set('speech.listeningSpeed', 9);
  expect(host.panelSpeech.settings.get()).toMatchObject({ listeningSpeed: 1 });
  const current = host.panelSpeech.settings.get();
  host.panelSpeech.settings.set({ ...current, listeningSpeed: 1.25 });
  expect(fakes.cancel).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledWith('speech.listeningSpeed', 1.25, 1);
  });
  host.dispose();
});

it('constructs the listening-speed worker from the fixed local extension path', () => {
  tempoPaths.length = 0;
  const { host } = harness();
  expect(tempoPaths).toEqual(['/extension/dist/speech/tempo_worker.mjs']);
  host.dispose();
});

it('passes local readiness facts to the readiness check', async () => {
  const { host } = harness();
  expect(await host.ready()).toBe(true);
  const facts = fakes.readiness.mock.lastCall?.[0];
  expect(facts).toBeDefined();
  expect(facts?.settings().enabled).toBe(false);
  expect(facts?.desktop()).toBe(true);
  await expect(facts?.key()).resolves.toBe(false);
  await expect(facts?.model()).resolves.toBe(false);
  expect(facts?.local()).toBe(false);
  await Promise.resolve();
  expect(facts?.output()).toBe(true);
  host.dispose();
  expect(facts?.desktop()).toBe(false);
});

it('persists the compute choice and runs an explicit GPU check without assuming readiness', async () => {
  const { host, panel } = harness();
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
  expect(fakes.speechOptions?.computeMode?.()).toBe('cpu');
  fakes.speechOptions?.actualBackend?.('cpu');
  expect(host.panelSpeech.computeState().actualBackend).toBe('cpu');
  fakes.speechOptions?.gpuCheck?.({ phase: 'unavailable', reason: 'runtime_missing' });
  expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  host.panelSpeech.computeMode('gpu');
  expect(fakes.cancel).toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledWith('speech.computeMode', 'gpu', 1);
  });
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
  expect(panel.showSpeechComputeState).toHaveBeenCalled();
});

it('records cloud narration failures in companion diagnostics', () => {
  const { host, diagnostic } = harness();
  fakes.cloudDiagnostic?.('auth');
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'narration', provider: 'elevenlabs', phase: 'failed', reason: 'auth' });
  host.dispose();
});

it('keeps the latest compute choice across pending saves and restores it after a failed save', async () => {
  const { host } = harness();
  const first = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(first.promise);
  host.panelSpeech.computeMode('auto');
  host.panelSpeech.computeMode('gpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
  first.resolve();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(2);
  });
  fakes.config.set('speech.computeMode', 'auto');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('gpu');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledWith('Could not save speech compute mode.');
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('auto');
  fakes.config.set('speech.computeMode', 'cpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
});

it('ignores a stale compute save failure and normalizes stored and external choices', async () => {
  const { host } = harness();
  const stale = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(stale.promise);
  host.panelSpeech.computeMode('auto');
  host.panelSpeech.computeMode('gpu');
  stale.reject(new Error('private'));
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(2);
  });
  expect(fakes.errorMessage).not.toHaveBeenCalled();
  fakes.config.set('speech.computeMode', 'gpu');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('cpu');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledOnce();
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
  fakes.config.set('speech.computeMode', 'invalid');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('auto');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledTimes(2);
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
  fakes.config.set('speech.computeMode', 'gpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
});

it('routes explicit GPU setup through preflight, model installation, fresh proof and disposal cancellation', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'));
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.gpuFlow).toBeDefined();
  });
  const flow = fakes.gpuFlow;
  if (flow === undefined) throw new Error('Missing GPU setup flow');
  expect(await flow.preflight()).toEqual({ phase: 'ready' });
  await flow.cpuModel();
  expect(fakes.installed).toHaveBeenCalledWith('/storage');
  expect(await flow.gpuModel()).toBe('/gpu');
  await flow.download(() => {});
  expect(fakes.gpuDownload).toHaveBeenCalledWith('/storage', expect.objectContaining({ signal: flow.signal }));
  expect(await flow.verify('/gpu')).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability: { modelDirectory: '/other' } });
  expect(await flow.verify('/gpu')).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability: { modelDirectory: '/gpu' } });
  expect(await flow.verify('/gpu')).toEqual({ phase: 'ready' });
  host.dispose();
  expect(flow.signal.aborted).toBe(true);
  fakes.speechOptions?.actualBackend?.('none');
});

it('enables GPU inference only with an explicit reviewed gate and fresh host capability', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  const capability: import('../../vscode/src/speech_gpu_client').GpuLaunchCapability = {
    modelDirectory: '/gpu',
    runtimeDirectory: '/runtime',
    executablePath: '/node',
    loaderPath: '/loader',
    loaderSha256: 'a'.repeat(64),
    environment: { LANG: 'C', VK_DRIVER_FILES: '/driver', VK_LOADER_LAYERS_DISABLE: '~all~' },
  };
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability });
  expect(await fakes.speechOptions?.gpuCapability?.()).toEqual({ check: { phase: 'ready' }, capability });
  const listener = { ready: vi.fn(), retired: vi.fn() };
  fakes.speechOptions?.createGpu?.(capability, listener);
  expect(fakes.gpuClientFactory).toHaveBeenCalledWith({ capability, listener });
  host.dispose();
});

it('NoSuccessorBeforeReap: serializes explicit setup and speech admission proof', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  const setup = Promise.withResolvers<import('../../vscode/src/speech_compute_types').GpuCheck>();
  fakes.gpuFlowResult.mockReturnValueOnce(setup.promise);
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.gpuFlow).toBeDefined();
  });
  expect(fakes.speechOptions?.gpuExternalBusy?.()).toBe(false);
  const preflight = Promise.withResolvers<import('../../vscode/src/speech_compute_types').GpuCheck>();
  fakes.gpuPreflight.mockReturnValueOnce(preflight.promise);
  const checking = fakes.gpuFlow?.preflight();
  expect(fakes.speechOptions?.gpuExternalBusy?.()).toBe(true);
  preflight.resolve({ phase: 'ready' });
  await checking;
  expect(fakes.speechOptions?.gpuExternalBusy?.()).toBe(false);
  expect(await fakes.speechOptions?.gpuCapability?.()).toEqual({ check: { phase: 'checking' } });
  expect(fakes.gpuIssue).not.toHaveBeenCalled();
  setup.resolve({ phase: 'unavailable', reason: 'probe_failed' });
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck.phase).toBe('unavailable');
  });
  expect(fakes.speechOptions?.gpuExternalBusy?.()).toBe(false);
  const admission = Promise.withResolvers<import('../../vscode/src/speech_gpu_capability').GpuCapabilityResult>();
  fakes.gpuIssue.mockReturnValueOnce(admission.promise);
  const pending = fakes.speechOptions?.gpuCapability?.();
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'busy' });
  });
  admission.resolve({ check: { phase: 'unavailable', reason: 'probe_failed' } });
  await pending;
  host.dispose();
});

it('does not run GPU setup while an inference worker still owns the slot', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  fakes.gpuSlotBusy.mockReturnValue(true);
  fakes.gpuFlow = undefined;
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'busy' });
  });
  expect(fakes.gpuFlow).toBeUndefined();
  expect(fakes.retireIdleGpu).toHaveBeenCalledOnce();
  host.dispose();
  fakes.gpuSlotBusy.mockReturnValue(false);
});

it('drops a setup proof that settles after the host is disposed', async () => {
  const { host, panel } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  const pending = Promise.withResolvers<import('../../vscode/src/speech_compute_types').GpuCheck>();
  fakes.gpuFlowResult.mockReturnValueOnce(pending.promise);
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.gpuFlow).toBeDefined();
  });
  host.dispose();
  const updates = panel.showSpeechComputeState.mock.calls.length;
  pending.resolve({ phase: 'ready' });
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  });
  expect(panel.showSpeechComputeState).toHaveBeenCalledTimes(updates);
});

it('does not offer GPU setup from a non-desktop host', async () => {
  fakes.uiKind = 2;
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  fakes.gpuFlow = undefined;
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'unsupported' });
  });
  expect(fakes.gpuFlow).toBeUndefined();
  host.dispose();
  fakes.uiKind = 1;
});
