import * as vscode from 'vscode';
import {
  CommandChannel,
  LOCAL_AUDIO_VERSION,
  PanelChunkAssembler,
  localSpeechReport,
  type LocalAudioFrame,
  type LocalPanelAction,
  type LocalSpeechReport,
} from '@ai-pair/protocol';
import { createLocalAudioAdapter } from '../../audio-native/src/factory';
import { NarrationPanel } from '../../vscode/src/panel';
import { Diagnostics } from '../../vscode/src/diagnostics';
import { createGpuProofRunner } from '../../vscode/src/speech_gpu_proof_runner';
import { CompanionNarration } from './companion_narration';
import { LocalConnection } from './local_connection';
import { createSpeechHost, type LocalSpeechObservation, type SpeechHost } from './speech_host';

/** Values compiled into this companion bundle. */
declare const AI_PAIR_VERSION: string;
declare const AI_PAIR_BUILD_ID: string;

/** Maximum delay for a command acknowledgement. */
const COMMAND_TIMEOUT_MS = 3000;
/** Maximum queued outbound commands. */
const MAX_PENDING_COMMANDS = 128;
/** Local silence follows a missed heartbeat within this lease. */
const LEASE_MS = 10_000;

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
  let host: SpeechHost;
  let channel: CommandChannel<LocalAudioFrame>;
  const assembler = new PanelChunkAssembler();
  const diagnostics = new Diagnostics({ version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID });
  function nextSequence(): number {
    return ++sequence;
  }
  function shutdown(notify: boolean): Promise<void> {
    if (shutdownPromise !== undefined) return shutdownPromise;
    closed = true;
    panel?.showSpeechTransport(false);
    assembler.setPage(undefined);
    narration.dispose();
    shutdownPromise = Promise.resolve(host.dispose());
    connection.dispose();
    channel.dispose();
    if (notify) void vscode.window.showWarningMessage('AI Pair lost its local audio connection. Reload the window to reconnect.');
    return shutdownPromise;
  }
  channel = new CommandChannel<LocalAudioFrame>({
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxPending: MAX_PENDING_COMMANDS,
    lost: () => {
      void shutdown(true);
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
      void shutdown(true);
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
      speech: host.panelSpeech,
    },
    { get: () => 'newestFirst', set: () => {} },
    { version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID },
    { get: () => false, set: () => {} },
    () => false,
    { get: () => 'typing', set: () => {} },
    { get: () => 'interrupt', set: () => {} },
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
      if (action.type === 'ready') {
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
      return shutdown(false);
    },
  };
}
