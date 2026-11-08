import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { LOCAL_AUDIO_VERSION, localAudioPrepared } from '@ai-pair/protocol';
import { AttachmentGate } from './attachment_gate';
import { createCompanionSession, type CompanionSession } from './companion_session';

/** How long a prepared but uncommitted attachment remains valid. */
const PREPARE_TIMEOUT_MS = 5000;

/** Registers only the companion's private commands until attachment is committed. */
export function activate(context: vscode.ExtensionContext): void {
  let session: CompanionSession | undefined;
  let commitEpoch = '';
  const gate = new AttachmentGate({
    token: randomUUID,
    timeoutMs: PREPARE_TIMEOUT_MS,
    register: () => {
      session = createCompanionSession(context, commitEpoch);
    },
  });
  context.subscriptions.push(
    gate,
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
      return gate.commit(parsed.data);
    }),
    vscode.commands.registerCommand('aiPair.localAudio.frame', (value: unknown) => session?.accept(value) ?? false),
    vscode.commands.registerCommand('aiPair.localAudio.keySet', () => session?.keySet() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.keyRemove', () => session?.keyRemove() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.preview', () => session?.preview() ?? Promise.resolve()),
    vscode.commands.registerCommand('aiPair.localAudio.ready', (epoch: unknown) => session?.ready(epoch) ?? Promise.resolve(false)),
    vscode.commands.registerCommand('aiPair.localAudio.status', () => session?.observation()),
    vscode.commands.registerCommand('aiPair.localAudio.diagnostics', () => session?.diagnostics()),
    {
      dispose: () => {
        session?.dispose();
      },
    },
  );
}

/** Leaves disposal to the extension context. */
export function deactivate(): void {}
