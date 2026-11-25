import * as vscode from 'vscode';
import {
  CommandChannel,
  LOCAL_AUDIO_VERSION,
  PanelChunkAssembler,
  localSpeechReport,
  type ChannelLoss,
  type LocalAudioFrame,
  type LocalPanelAction,
  type LocalSpeechReport,
} from '@ai-pair/protocol';
import { createLocalAudioAdapter } from '../../audio-native/src/factory';
import { NarrationPanel } from '../../vscode/src/panel';
import { ShortcutWatcher } from '../../vscode/src/shortcut_watcher';
import { shortcutPlatform } from '../../vscode/src/shortcut_labels';
import { Diagnostics } from '../../vscode/src/diagnostics';
import { createGpuProofRunner } from '../../vscode/src/speech_gpu_proof_runner';
import { CompanionNarration } from './companion_narration';
import { CompanionFacepalm } from './companion_facepalm';
import { FacepalmClient } from '../../vscode/src/facepalm_client';
import { openFacepalmSettings } from '../../vscode/src/facepalm_settings_launcher';
import { LocalConnection } from './local_connection';
import { createSpeechHost, type LocalSpeechObservation, type SpeechHost } from './speech_host';

/** Values compiled into this companion bundle. */
declare const AI_PAIR_VERSION: string;
declare const AI_PAIR_BUILD_ID: string;

/** Maximum delay for a command acknowledgement, as long as the workspace waits for one (#115). */
const COMMAND_TIMEOUT_MS = 10_000;
/** Milliseconds in a second, for a lease stated in seconds. */
const MS_PER_SECOND = 1000;
/** Why this side dropped its workspace connection, as its warning says (#115). */
const CHANNEL_LOSS: Record<ChannelLoss, string> = {
  timeout: 'the workspace did not answer a message in time',
  refused: 'the workspace refused a message',
  overflow: 'too many messages were waiting for the workspace',
  closed: 'the connection was closed',
};
/** Maximum queued outbound commands. */
const MAX_PENDING_COMMANDS = 128;
/**
 * Local silence follows a missed heartbeat within this lease. It outlasts the workspace's 10 s wait for
 * one acknowledgement plus a heartbeat interval, so a stall the workspace survives cannot end it (#115).
 */
const LEASE_MS = 20_000;

/** Operations exposed to the private activation commands. */
export interface CompanionSession {
  accept(value: unknown): boolean;
  keySet(): Promise<void>;
  keyRemove(): Promise<void>;
  preview(): Promise<void>;
  observation(): LocalSpeechObservation | undefined;
  ready(epoch: unknown): Promise<boolean>;
  diagnostics(): LocalSpeechReport | undefined;
  audioDiagnostics(): import('@ai-pair/protocol').AudioDiagnostics;
  gpuDiagnostics(): import('@ai-pair/protocol').GpuDiagnostics;
  dispose(): Promise<void>;
}

/** Refuses workspace-only operations inside the UI host. */
function workspaceOnly(): never {
  throw new Error('Workspace operation is unavailable in the local companion.');
}

/** Creates the one UI-local provider, speech service and command receiver. */
export function createCompanionSession(context: vscode.ExtensionContext, epoch: string): CompanionSession {
  let sequence = 0;
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;
  let panel: NarrationPanel | undefined;
  let connection: LocalConnection;
  let narration: CompanionNarration;
  let pageClose: Promise<boolean> = Promise.resolve(true);
  let readyPage: number | undefined;
  let host: SpeechHost;
  let channel: CommandChannel<LocalAudioFrame>;
  const localFacepalm = new FacepalmClient();
  const localLog = vscode.window.createOutputChannel('AI Pair Local Audio', { log: true });
  let facepalm: CompanionFacepalm;
  const assembler = new PanelChunkAssembler();
  const diagnostics = new Diagnostics({ version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID });
  function nextSequence(): number {
    return ++sequence;
  }
  /** Retires the session once; a lost connection is reported with the reason this side gave up (#115). */
  function shutdown(lost?: string): Promise<void> {
    if (shutdownPromise !== undefined) return shutdownPromise;
    // Install the barrier before observers or disposal can synchronously reenter shutdown.
    const completion = Promise.withResolvers<void>();
    shutdownPromise = completion.promise;
    closed = true;
    const failures: unknown[] = [];
    function attempt(effect: () => void): void {
      try {
        effect();
      } catch (error) {
        failures.push(error);
      }
    }
    let facepalmStopped = Promise.resolve();
    let speechStopped = Promise.resolve();
    attempt(() => {
      panel?.showSpeechTransport(false);
    });
    attempt(() => {
      assembler.setPage(undefined);
    });
    attempt(() => {
      narration.dispose();
    });
    attempt(() => {
      facepalmStopped = facepalm.dispose();
    });
    attempt(() => {
      panel?.showFacepalmStatus(localFacepalm.snapshot());
    });
    attempt(() => {
      speechStopped = Promise.resolve(host.dispose());
    });
    attempt(() => {
      connection.dispose();
    });
    attempt(() => {
      channel.dispose();
    });
    if (lost !== undefined) {
      attempt(() => {
        void vscode.window.showWarningMessage(
          `AI Pair Local Audio lost its workspace connection: ${lost}. Reload the window to reconnect.`,
        );
      });
    }
    try {
      localLog.dispose();
    } catch {
      /* A diagnostic channel cannot prevent retirement. */
    }
    void Promise.allSettled([facepalmStopped, speechStopped]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      if (failures.length > 0) completion.reject(failures[0]);
      else completion.resolve();
    });
    return shutdownPromise;
  }
  channel = new CommandChannel<LocalAudioFrame>({
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxPending: MAX_PENDING_COMMANDS,
    lost: (reason) => {
      void shutdown(CHANNEL_LOSS[reason]);
    },
    send: async (frame) => {
      await vscode.commands.executeCommand('aiPair.localAudio.workspace', frame);
    },
  });
  host = createSpeechHost({
    context,
    connectionEpoch: epoch,
    enableGpuInference: true,
    gpuProof: (capability, kind, signal) => createGpuProofRunner(capability)(kind, signal),
    adapter: createLocalAudioAdapter(context.extensionPath),
    page: () => panel?.speechReadyPageId(),
    panel: () => panel,
    diagnostic: (event) => {
      diagnostics.record(event);
    },
  });
  facepalm = new CompanionFacepalm({
    client: localFacepalm,
    diagnostic: (message) => {
      localLog.info(message);
    },
    epoch,
    page: () => panel?.speechReadyPageId(),
    nextSequence,
    send: (frame) => {
      void channel.send(frame);
    },
    openSettings: (onLateFailure) =>
      openFacepalmSettings(process.platform, false, onLateFailure, (diagnostic) => {
        localLog.warn(`Facepalm settings process: reason=${diagnostic.reason}, signal=${diagnostic.signal}`);
      }),
  });
  localFacepalm.onStatus = (snapshot) => {
    void channel.send({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: epoch,
      sequence: nextSequence(),
      type: 'facepalmStatus',
      pageEpoch: panel?.speechReadyPageId() ?? 0,
      snapshot,
    });
  };
  narration = new CompanionNarration({
    epoch,
    speech: host.speech,
    page: () => panel?.speechReadyPageId(),
    stopOutput: () => host.output.stopAndWait(),
    observation: () => host.observation(),
    nextSequence,
    send: (frame) => {
      void channel.send(frame);
    },
  });
  connection = new LocalConnection({
    leaseMs: LEASE_MS,
    lost: () => {
      void shutdown(`no heartbeat from the workspace for ${LEASE_MS / MS_PER_SECOND} seconds`);
    },
    receive: (frame) => {
      if (frame.type === 'panelChunk') {
        const update = assembler.accept({
          pageEpoch: frame.pageEpoch,
          messageId: frame.messageId,
          index: frame.index,
          count: frame.count,
          data: frame.data,
        });
        if (update !== undefined) panel?.showRemoteUpdate(update);
      } else if (frame.type.startsWith('facepalm')) {
        facepalm.accept(frame);
      } else if (frame.type !== 'heartbeat') {
        narration.receive(frame);
      }
    },
  });
  connection.attach({ version: LOCAL_AUDIO_VERSION, connectionEpoch: epoch, sequence: 1, type: 'attach' });
  const numberSetting = { get: () => 1, set: () => {} };
  panel = new NarrationPanel(
    workspaceOnly,
    numberSetting,
    numberSetting,
    { current: () => undefined, ref: () => undefined },
    () => {},
    context.extensionUri,
    {
      controller: workspaceOnly,
      calibration: workspaceOnly,
      starter: { available: () => Promise.resolve(false), start: () => Promise.resolve() },
      copyDiagnostics: () => Promise.resolve(),
      requireCommandApproval: workspaceOnly,
      speech: host.panelSpeech,
    },
    { get: () => 'newestFirst', set: () => {} },
    { version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID },
    { get: () => false, set: () => {} },
    () => false,
    { get: () => 'typing', set: () => {} },
    { get: () => 'interrupt', set: () => {} },
    { get: () => false, set: () => {} },
    { get: workspaceOnly, set: workspaceOnly },
  );
  function sendAction(action: LocalPanelAction, page: number): void {
    void channel.send({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: epoch,
      sequence: nextSequence(),
      type: 'panelAction',
      pageEpoch: page,
      action,
    });
  }
  panel.useCompanion({
    forward: (action, page) => {
      // specs/FacepalmSettingsControl.tla, ReplaceOwner: a lost attachment cannot accept controls.
      if (closed && (action.type === 'facepalmOpenSettings' || action.type === 'facepalmRefresh' || action.type === 'facepalmEnabled')) {
        void vscode.window.showWarningMessage('AI Pair Local Audio is disconnected. Reload the window to use Facepalm.');
        return;
      }
      if (action.type === 'ready') {
        if (readyPage !== undefined && readyPage !== page) facepalm.retire();
        readyPage = page;
        assembler.setPage(page);
        void pageClose.then((retired) => {
          if (retired && !closed) sendAction(action, page);
        });
        return;
      }
      if (action.type === 'draft') narration.setLocalPause(!action.empty);
      if (action.type === 'pause') narration.setLocalPause(true, 'manual');
      if (action.type === 'resume') {
        narration.setLocalPause(false, 'draft');
        narration.setLocalPause(false, 'manual');
      }
      // specs/DeferredMessage.tla, SendDeferred: keep the current narration until the action ends.
      if (action.type === 'reply' && action.defer === true) {
        narration.setLocalPause(false, 'draft');
        narration.setLocalPause(false, 'manual');
        sendAction(action, page);
      } else if (action.type === 'turn' && action.message === undefined && action.attach !== true) {
        sendAction(action, page);
      } else if (action.type === 'reply' || action.type === 'interrupt' || action.type === 'turn' || action.type === 'end') {
        const stopped = narration.interruptThen(() => {
          sendAction(action, page);
        });
        if (action.type === 'reply' || action.type === 'turn') {
          narration.setLocalPause(false, 'draft');
          narration.setLocalPause(false, 'manual');
        }
        void stopped.catch(() => {
          void vscode.window.showWarningMessage('AI Pair could not stop local audio; the action was not sent.');
        });
      } else {
        sendAction(action, page);
      }
    },
    closed: (page) => {
      if (readyPage === page) readyPage = undefined;
      facepalm.retire();
      assembler.setPage(undefined);
      pageClose = narration
        .interruptThen(() => {
          sendAction({ type: 'pageClosed' }, page);
        })
        .then(
          () => true,
          () => {
            void vscode.window.showWarningMessage('AI Pair could not stop local audio. Reload the window.');
            return false;
          },
        );
      narration.setLocalPause(false, 'draft');
    },
  });
  const provider = vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, panel, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  // The page runs here, so its tooltips name this machine's shortcuts (#94). VS Code's User folder holds globalStorage.
  const shortcutPanel = panel;
  const shortcuts = new ShortcutWatcher(
    vscode.Uri.joinPath(context.globalStorageUri, '..', '..'),
    shortcutPlatform(process.platform),
    (labels) => {
      shortcutPanel.showShortcuts(labels);
    },
  );
  return {
    accept: (value) => connection.accept(value),
    keySet: () => host.panelSpeech.keySet(),
    keyRemove: () => host.panelSpeech.keyRemove(),
    preview: () => host.panelSpeech.preview(),
    observation: () => host.observation(),
    ready: async (requestedEpoch) => requestedEpoch === epoch && !closed && (await host.ready()) && !closed,
    gpuDiagnostics: () => host.gpuDiagnostics(),
    audioDiagnostics: () => host.audioDiagnostics(),
    diagnostics: () => {
      const snapshot = diagnostics.snapshot();
      const report = localSpeechReport.safeParse({ version: snapshot.version, build: snapshot.build, events: snapshot.events });
      return report.success ? report.data : undefined;
    },
    dispose: () => {
      provider.dispose();
      shortcuts.dispose();
      return shutdown();
    },
  };
}
