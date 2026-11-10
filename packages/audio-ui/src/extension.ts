import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION, localAudioPrepared } from '@ai-pair/protocol';
import { AttachmentGate } from './attachment_gate';
import { createCompanionSession, type CompanionSession } from './companion_session';

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
  function close(): Promise<void> {
    stopped = true;
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
    if (!stopped) session = createCompanionSession(context, epoch);
  }
  const gate = new AttachmentGate({
    token: randomUUID,
    timeoutMs: PREPARE_TIMEOUT_MS,
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
