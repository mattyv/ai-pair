import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AudioAdapter, AudioCapabilities, AudioChoice } from '../../audio-native/src';
import type { SpeechDiagnosticEvent } from '../../vscode/src/diagnostics';
import type { PanelWiring } from '../../vscode/src/panel';
import type { SpeechState } from '../../vscode/src/panel_messages';
import { SpeechCatalog, type CatalogView } from '../../vscode/src/speech_catalog';
import { SpeechCredentials } from '../../vscode/src/speech_credentials';
import { ElevenLabsClient } from '../../vscode/src/speech_elevenlabs';
import { SpeechOutputPreferences, type OutputPreferenceView } from '../../vscode/src/speech_output_preferences';
import { speechRuntimeAvailable } from '../../vscode/src/speech_runtime_status';
import { localSpeechPlatform } from '../../vscode/src/speech_platform';
import { SpeechService } from '../../vscode/src/speech_service';
import { SpeechCompute } from '../../vscode/src/speech_compute';
import type { SpeechComputeState } from '../../vscode/src/speech_compute_types';
import { speechReady } from '../../vscode/src/speech_readiness';
import { SpeechTempoClient } from '../../vscode/src/speech_tempo_client';
import { installedSpeechModel, setupSpeech, speechModelStatus } from '../../vscode/src/speech_setup';
import { speechListeningRate, type SpeechSettings } from '../../vscode/src/speech_types';
import { CompanionOutput } from './companion_output';

/** The local panel operations used by the speech host. */
export interface SpeechHostPanel {
  showSpeechKeyStatus(hasKey: boolean): void;
  showSpeechOutputCatalog(value: OutputPreferenceView): void;
  showSpeechCatalog(value: CatalogView): void;
  showSpeechSettings(value: SpeechSettings): void;
  showSpeechComputeState(value: SpeechComputeState): void;
  showSpeechStatus(id: number, state: SpeechState, message?: string): void;
  refreshSpeechSupport(): void;
}

/** Local collaborators; no credentials or audio cross the workspace connection. */
export interface SpeechHostOptions {
  context: vscode.ExtensionContext;
  connectionEpoch: string;
  adapter: AudioAdapter;
  page: () => number | undefined;
  panel: () => SpeechHostPanel | undefined;
  diagnostic: (event: SpeechDiagnosticEvent) => void;
}

/** Sanitized local speech lifecycle facts for integration observation. */
export interface LocalSpeechObservation {
  id: number;
  state: SpeechState;
  started: boolean;
  terminal?: 'ended' | 'failed';
}

/** The UI-local speech service and its panel wiring. */
export interface SpeechHost {
  speech: SpeechService;
  output: CompanionOutput;
  panelSpeech: PanelWiring['speech'];
  observation(): LocalSpeechObservation | undefined;
  ready(): Promise<boolean>;
  dispose(): void;
}

/** Returns the local AI Pair configuration. */
function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiPair');
}

/** Creates the local speech, credentials and output composition. */
export function createSpeechHost(options: SpeechHostOptions): SpeechHost {
  const { context, adapter } = options;
  const desktop = vscode.env.uiKind === vscode.UIKind.Desktop;
  const platformResult = desktop ? localSpeechPlatform() : { supported: false as const, reason: 'host_platform' as const };
  const platform = platformResult.supported;
  const runtimeDirectory = path.join(context.extensionPath, 'dist', 'speech');
  let runtimeAvailable = false;
  let disposed = false;
  let keyEpoch = 0;
  let invalidVoice = false;
  let pending: SpeechSettings | undefined;
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();
  let catalogActive = false;
  let speech: SpeechService;
  let credentials: SpeechCredentials;
  let catalog: SpeechCatalog;
  let output: CompanionOutput;
  let capability: AudioCapabilities | undefined;
  let capabilityGeneration = 0;
  let observation: LocalSpeechObservation | undefined;
  let previewCapture = false;
  let previewId: number | undefined;
  let previewSequence = 0;
  const compute = new SpeechCompute(
    config().get('speech.computeMode'),
    () => Promise.resolve({ phase: 'unavailable', reason: 'runtime_missing' }),
    (value) => {
      options.panel()?.showSpeechComputeState(value);
    },
  );
  let computeGeneration = 0;
  let computeTail: Promise<void> = Promise.resolve();
  let computePending = false;
  let previewProvider: 'kokoro' | 'elevenlabs' = 'kokoro';

  function stored(): SpeechSettings {
    const enabled: unknown = config().get('speech.enabled');
    const voice: unknown = config().get('speech.voice');
    const speed: unknown = config().get('speech.speed');
    const provider: unknown = config().inspect('speech.provider')?.globalValue;
    const cloudVoice: unknown = config().get('speech.elevenLabsVoice');
    const cloudSpeed: unknown = config().get('speech.elevenLabsSpeed');
    return {
      enabled: enabled === true,
      listeningSpeed: speechListeningRate(config().get('speech.listeningSpeed')),
      voice: typeof voice === 'string' ? voice : 'af_heart',
      speed: typeof speed === 'number' ? speed : 1,
      provider: provider === 'elevenlabs' ? 'elevenlabs' : 'kokoro',
      elevenLabsVoice: !invalidVoice && typeof cloudVoice === 'string' ? cloudVoice : '',
      elevenLabsSpeed: typeof cloudSpeed === 'number' ? cloudSpeed : 1,
    };
  }
  let last = stored();
  const settings = {
    get: (): SpeechSettings => pending ?? stored(),
    set: (value: SpeechSettings): void => {
      const prior = settings.get();
      if ((prior.enabled && !value.enabled) || prior.provider !== value.provider) {
        speech.cancel();
        if (prior.provider !== value.provider) {
          credentials.supersede();
          catalog.invalidate();
        }
      }
      const restoresVoice = invalidVoice && value.elevenLabsVoice !== '' && catalog.contains(value.elevenLabsVoice);
      // specs/ProviderChoice.tla, Select: the latest local choice takes effect before persistence.
      const current = ++generation;
      pending = { ...value, listeningSpeed: speechListeningRate(value.listeningSpeed) };
      last = value;
      const save = tail.then(async () => {
        const updates: Array<[string, unknown]> = [
          ['speech.enabled', value.enabled],
          ['speech.listeningSpeed', speechListeningRate(value.listeningSpeed)],
          ['speech.voice', value.voice],
          ['speech.speed', value.speed],
          ['speech.provider', value.provider],
          ['speech.elevenLabsVoice', value.elevenLabsVoice],
          ['speech.elevenLabsSpeed', value.elevenLabsSpeed],
        ];
        for (const [key, setting] of updates) await config().update(key, setting, vscode.ConfigurationTarget.Global);
      });
      tail = save.catch(() => {});
      void save.then(
        () => {
          // specs/ProviderChoice.tla, Success: older writes cannot replace a newer choice.
          if (current !== generation || disposed) return;
          pending = undefined;
          if (restoresVoice) invalidVoice = false;
          options.panel()?.showSpeechSettings(stored());
        },
        () => {
          if (current !== generation || disposed) return;
          pending = undefined;
          speech.cancel();
          catalog.invalidate();
          last = stored();
          options.panel()?.showSpeechSettings(last);
          void vscode.window.showErrorMessage('Could not save speech settings.');
        },
      );
    },
  };
  credentials = new SpeechCredentials(
    context.secrets,
    () =>
      vscode.window.showInputBox({
        title: 'ElevenLabs API key',
        password: true,
        ignoreFocusOut: true,
        prompt: 'Use a key with Text to Speech and Voices read access.',
      }),
    () => {
      keyEpoch++;
      catalog.invalidate();
      speech.invalidateCloud();
      invalidVoice = true;
      settings.set({ ...settings.get(), elevenLabsVoice: '' });
    },
  );
  const cloud = new ElevenLabsClient(() => credentials.read());
  catalog = new SpeechCatalog(cloud, (value) => {
    if (value.reset) catalogActive = false;
    else if (value.loading) catalogActive = true;
    else if (catalogActive) {
      catalogActive = false;
      options.diagnostic({
        kind: 'speech',
        event: 'catalog',
        provider: 'elevenlabs',
        phase: value.error ? 'failed' : 'ready',
        ...(value.error ? { reason: value.errorKind ?? 'unknown' } : value.voices.length === 0 ? { reason: 'no_voice' } : {}),
      });
    }
    if (!disposed) options.panel()?.showSpeechCatalog(value);
  });
  function refreshKey(): void {
    const epoch = ++keyEpoch;
    void credentials.hasKey().then(
      (hasKey) => {
        if (disposed || epoch !== keyEpoch) return;
        options.panel()?.showSpeechKeyStatus(hasKey);
        options.diagnostic({
          kind: 'speech',
          event: 'capability',
          provider: 'elevenlabs',
          phase: desktop && hasKey ? 'ready' : 'blocked',
          ...(!desktop ? { reason: 'unsupported' as const } : !hasKey ? { reason: 'no_key' as const } : {}),
        });
      },
      () => {
        if (!disposed && epoch === keyEpoch) options.panel()?.showSpeechKeyStatus(false);
      },
    );
  }
  const preferences = new SpeechOutputPreferences({
    initial: context.globalState.get('speechOutput'),
    write: async (value) => {
      await context.globalState.update('speechOutput', value);
    },
    stop: () => {
      speech.cancel();
      void output.stopAndWait().catch(() => {});
    },
    changed: (value) => {
      if (!disposed) options.panel()?.showSpeechOutputCatalog(value);
    },
    discover: async () => {
      const sequence = ++capabilityGeneration;
      capability = undefined;
      const discovered = await adapter.capabilities();
      if (sequence === capabilityGeneration) capability = discovered;
      const backend = discovered.backend;
      if (
        (!discovered.defaultOutput && !discovered.deviceSelection) ||
        (backend !== 'pipewire' && backend !== 'coreaudio' && backend !== 'wasapi')
      ) {
        return { supported: false, devices: [], reason: 'unsupported' };
      }
      const devices = discovered.deviceSelection ? await adapter.list() : [];
      return {
        supported: true,
        devices: devices.map((device) => ({
          choice: { kind: 'native' as const, backend, name: device.id },
          label: device.label,
          available: true,
        })),
      };
    },
  });
  function choice(): AudioChoice {
    const selected = preferences.choice();
    return selected.kind === 'default' ? { kind: 'default' } : { kind: 'device', id: selected.name };
  }
  function outputReady(): boolean {
    const selected = preferences.choice();
    // specs/LocalAudioAdmission.tla, Admit: do not dispatch a provider without the selected local route.
    return (
      capability !== undefined &&
      (selected.kind === 'default'
        ? capability.defaultOutput
        : capability.deviceSelection && capability.backend === selected.backend && preferences.ready())
    );
  }
  output = new CompanionOutput({
    adapter,
    connectionEpoch: options.connectionEpoch,
    page: options.page,
    choice,
    ready: outputReady,
    event: (event) => {
      const terminal = speech.audioEvent(event);
      if (terminal !== undefined && observation?.id === event.id) observation = { ...observation, terminal };
    },
    localDiagnostic: (phase, reason) => {
      options.diagnostic({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase, ...(reason === undefined ? {} : { reason }) });
    },
    status: (id, state, message) => {
      if (previewCapture) previewId = id;
      if (id === previewId && (state === 'speaking' || state === 'unavailable')) {
        options.diagnostic({
          kind: 'speech',
          event: 'preview',
          provider: previewProvider,
          phase: state === 'speaking' ? 'ready' : 'failed',
          ...(state === 'unavailable' ? { reason: 'unknown' as const } : {}),
        });
      }
      const started = state === 'speaking' || (observation?.id === id && observation.started);
      observation = { id, state, started };
      if (!disposed) options.panel()?.showSpeechStatus(id, state, message);
    },
  });
  speech = new SpeechService({
    cloudDiagnostic: (reason) => {
      options.diagnostic({ kind: 'speech', event: 'narration', provider: 'elevenlabs', phase: 'failed', reason });
    },
    runtimeDirectory,
    tempo: new SpeechTempoClient(path.join(runtimeDirectory, 'tempo_worker.mjs')),
    storageDirectory: context.globalStorageUri.fsPath,
    localDesktop: desktop,
    kokoroSupported: platform,
    cloud,
    settings: settings.get,
    computeMode: () => compute.state().requestedMode,
    actualBackend: (value) => {
      compute.actual(value);
    },
    output,
  });
  void speechRuntimeAvailable(runtimeDirectory).then((available) => {
    if (disposed) return;
    runtimeAvailable = available;
    options.diagnostic({
      kind: 'speech',
      event: 'capability',
      provider: 'kokoro',
      phase: platform && available ? 'ready' : 'blocked',
      ...(!platformResult.supported ? { reason: platformResult.reason } : !available ? { reason: 'not_ready' as const } : {}),
    });
    options.panel()?.refreshSpeechSupport();
  });
  const initialCapability = ++capabilityGeneration;
  void adapter.capabilities().then(
    (value) => {
      if (!disposed && initialCapability === capabilityGeneration) {
        capability = value;
        options.panel()?.showSpeechOutputCatalog(preferences.view());
      }
    },
    () => {},
  );
  const panelSpeech: PanelWiring['speech'] = {
    computeState: () => compute.state(),
    computeMode: (value) => {
      speech.cancel();
      compute.select(value);
      const current = ++computeGeneration;
      computePending = true;
      const save = computeTail.then(() => config().update('speech.computeMode', value, vscode.ConfigurationTarget.Global));
      computeTail = save.catch(() => {});
      void save.then(
        () => {
          if (current === computeGeneration) computePending = false;
        },
        () => {
          if (current !== computeGeneration) return;
          computePending = false;
          const storedMode: unknown = config().get('speech.computeMode');
          compute.select(storedMode === 'auto' || storedMode === 'gpu' ? storedMode : 'cpu');
          void vscode.window.showErrorMessage('Could not save speech compute mode.');
        },
      );
    },
    checkGpuSetup: () => {
      void compute.check();
    },
    outputView: () => preferences.view(),
    outputReady,
    outputRetired: () => {},
    outputPageRetired: () => {},
    outputRefresh: () => {
      void preferences.refresh();
    },
    outputSelect: (value) => {
      void preferences.choose(value);
    },
    settings,
    diagnostic: options.diagnostic,
    cloudSupported: () => desktop,
    keySet: async () => {
      await credentials.set();
      refreshKey();
    },
    keyRemove: async () => {
      await credentials.remove();
      refreshKey();
    },
    keyRefresh: refreshKey,
    loadVoices: (more) => {
      void catalog.load(more);
    },
    validCloudVoice: (id) => catalog.contains(id),
    supported: () => platform && runtimeAvailable,
    installed: async () => (await installedSpeechModel(context.globalStorageUri.fsPath)) !== undefined,
    modelStatus: () => speechModelStatus(context.globalStorageUri.fsPath),
    setup: () => setupSpeech(context.globalStorageUri.fsPath),
    preview: () => {
      previewProvider = settings.get().provider;
      const sequence = ++previewSequence;
      previewId = undefined;
      previewCapture = true;
      try {
        return speech.preview().finally(() => {
          if (sequence === previewSequence) previewId = undefined;
        });
      } finally {
        previewCapture = false;
      }
    },
    stop: () => {
      speech.cancel();
    },
    event: (event) => {
      speech.audioEvent(event);
    },
    pageClosed: (pageId) => {
      speech.pageClosed(pageId);
      catalog.invalidate();
    },
  };
  const subscriptions = [
    context.secrets.onDidChange((event) => {
      if (event.key === 'aiPair.elevenLabs.apiKey') {
        credentials.invalidate();
        refreshKey();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('aiPair.speech')) return;
      if (!computePending) {
        const mode: unknown = config().get('speech.computeMode');
        const next = mode === 'auto' || mode === 'gpu' ? mode : 'cpu';
        if (next !== compute.state().requestedMode) {
          speech.cancel();
          compute.select(next);
        }
      }
      const current = settings.get();
      // specs/ProviderChoice.tla, External: persistence echoes cannot override a pending choice.
      if (pending === undefined) {
        if ((last.enabled && !current.enabled) || current.provider !== last.provider) speech.cancel();
        if (current.provider !== last.provider) {
          credentials.supersede();
          catalog.invalidate();
        }
        last = current;
      }
      options.panel()?.showSpeechSettings(current);
    }),
  ];
  return {
    speech,
    output,
    panelSpeech,
    observation: () => (observation === undefined ? undefined : { ...observation }),
    ready: () =>
      speechReady({
        settings: settings.get,
        desktop: () => desktop && !disposed,
        local: () => platform && runtimeAvailable,
        output: () => options.page() !== undefined && outputReady(),
        model: async () => (await installedSpeechModel(context.globalStorageUri.fsPath)) !== undefined,
        key: () => credentials.hasKey(),
      }),
    dispose: () => {
      disposed = true;
      subscriptions.forEach((subscription) => {
        subscription.dispose();
      });
      credentials.supersede();
      catalog.invalidate();
      speech.dispose();
      output.dispose();
    },
  };
}
