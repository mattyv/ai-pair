import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION, localAudioPrepared } from '@ai-pair/protocol';
import { AttachmentGate } from './attachment_gate';
import { createCompanionSession, type CompanionSession } from './companion_session';
import { NarrationPanel } from '../../vscode/src/panel';
import { ViewSlot } from './view_slot';

/** The companion's version, which the build defines from its manifest. */
declare const AI_PAIR_VERSION: string;
/** The companion's build ID, which the build defines from its inputs. */
declare const AI_PAIR_BUILD_ID: string;

/** How long a prepared but uncommitted attachment remains valid. */
const PREPARE_TIMEOUT_MS = 5000;

let closeActive: (() => Promise<void>) | undefined;
let retiring: Promise<void> | undefined;

/** Registers only the companion's private commands until attachment is committed. */
export function activate(context: vscode.ExtensionContext): void {
  if (closeActive !== undefined) void closeActive().catch(() => {});
  let session: CompanionSession | undefined;
  let commitEpoch = '';
  let closing: Promise<void> | undefined;
  let registration: Promise<void> | undefined;
  let stopped = false;
  /** The one Pair view provider, registered at the first commit and kept across reconnects (#127). */
  const slot = new ViewSlot();
  let provider: vscode.Disposable | undefined;
  function close(): Promise<void> {
    stopped = true;
    provider?.dispose();
    provider = undefined;
    if (closing !== undefined) return closing;
    if (session === undefined) return retiring ?? Promise.resolve();
    closing = Promise.resolve(session.dispose());
    retiring = closing;
    void closing.then(
      () => {
        retiring = undefined;
      },
      () => {},
    );
    return closing;
  }
  closeActive = close;
  function start(epoch: string): void {
    if (stopped) return;
    // specs/PanelPlacement.tla, Register: the provider registers only once a connection is committed.
    provider ??= vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, slot, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    session = createCompanionSession(context, epoch, slot);
  }
  /**
   * Retires the current session, provider included, for a new connection that replaces it; the next session starts once
   * this one has (specs/LocalAudioReconnect.tla, Attach; #127). Unlike close(), the extension keeps running.
   */
  function retireSession(): void {
    if (session === undefined) return;
    const retired = Promise.resolve(session.dispose());
    session = undefined;
    registration = undefined;
    retiring = retired;
    // No session starts, so none is retired again, before this retirement settles. One that fails keeps refusing new
    // connections, as a failed close does, so a second provider never registers.
    void retired.then(
      () => {
        retiring = undefined;
      },
      () => {},
    );
  }
  const gate = new AttachmentGate({
    token: randomUUID,
    extension: { version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID },
    timeoutMs: PREPARE_TIMEOUT_MS,
    retire: retireSession,
    register: () => {
      const epoch = commitEpoch;
      if (retiring === undefined) {
        start(epoch);
      } else {
        registration = retiring.then(() => {
          start(epoch);
        });
      }
    },
  });
  context.subscriptions.push(
    gate,
    // specs/PanelPlacement.tla, Activate: readiness does not prepare or register.
    vscode.commands.registerCommand('aiPair.localAudio.activate', () =>
      retiring === undefined
        ? !stopped
        : retiring.then(
            () => !stopped,
            () => false,
          ),
    ),
    vscode.commands.registerCommand('aiPair.localAudio.prepare', (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'version' in value && value.version !== LOCAL_AUDIO_VERSION) {
        void vscode.window.showWarningMessage(
          'AI Pair and AI Pair Local Audio have incompatible versions. Update both extensions and reload the window.',
        );
      }
      return gate.prepare(value);
    }),
    vscode.commands.registerCommand('aiPair.localAudio.commit', (value: unknown) => {
      const parsed = localAudioPrepared.safeParse(value);
      if (!parsed.success) return false;
      commitEpoch = parsed.data.epoch;
      if (!gate.commit(parsed.data)) return false;
      if (registration === undefined) return true;
      return registration.then(
        () => !stopped && session !== undefined,
        () => false,
      );
    }),
    vscode.commands.registerCommand('aiPair.localAudio.frame', (value: unknown) => session?.accept(value) ?? false),
    vscode.commands.registerCommand('aiPair.localAudio.keySet', () => session?.keySet() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.keyRemove', () => session?.keyRemove() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.preview', () => session?.preview() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.ready', (epoch: unknown) => session?.ready(epoch) ?? Promise.resolve(false)),
    vscode.commands.registerCommand('aiPair.localAudio.status', () => session?.observation()),
    vscode.commands.registerCommand('aiPair.localAudio.diagnostics', () => session?.diagnostics()),
    vscode.commands.registerCommand('aiPair.localAudio.audioDiagnostics', () => {
      try {
        return session?.audioDiagnostics();
      } catch {
        return undefined;
      }
    }),
    vscode.commands.registerCommand('aiPair.localAudio.gpuDiagnostics', () => session?.gpuDiagnostics()),
    {
      dispose: () => {
        void close();
      },
    },
  );
}

/** Waits for the local companion to release its resources. */
export function deactivate(): Promise<void> {
  return closeActive?.() ?? Promise.resolve();
}
