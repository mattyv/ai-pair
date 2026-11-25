import type { FacepalmSettingsLaunch } from '@ai-pair/protocol';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Time allowed for the operating system to start the launcher. */
const SPAWN_TIMEOUT_MS = 2000;
/** Time to detect an immediate Linux menu crash before accepting the launch. */
const STARTUP_GRACE_MS = 2000;
/** Maximum diagnostic text inspected; raw diagnostics are never displayed. */
const MAX_DIAGNOSTIC_CHARS = 4096;

/** Local-only, bounded facts about a failed menu process. */
export interface FacepalmSettingsDiagnostic {
  reason: Extract<FacepalmSettingsLaunch, { state: 'failed' }>['reason'];
  signal:
    | 'SIGABRT'
    | 'SIGTERM'
    | 'SIGKILL'
    | 'SIGSEGV'
    | 'SIGILL'
    | 'SIGBUS'
    | 'SIGTRAP'
    | 'SIGPIPE'
    | 'SIGSYS'
    | 'SIGHUP'
    | 'SIGINT'
    | 'other'
    | 'none';
}

/** Reduces the operating system signal to a fixed allowlist. */
function diagnosticSignal(signal: NodeJS.Signals | null): FacepalmSettingsDiagnostic['signal'] {
  const normalized = signal ?? undefined;
  switch (normalized) {
    case 'SIGABRT':
    case 'SIGTERM':
    case 'SIGKILL':
    case 'SIGSEGV':
    case 'SIGILL':
    case 'SIGBUS':
    case 'SIGTRAP':
    case 'SIGPIPE':
    case 'SIGSYS':
    case 'SIGHUP':
    case 'SIGINT':
      return normalized;
    case undefined:
      return 'none';
    default:
      return 'other';
  }
}

/** Gives a bounded, actionable message without exposing the child's raw stderr. */
export function facepalmSettingsWarning(
  result: Extract<FacepalmSettingsLaunch, { state: 'failed' }>,
  operation: 'open' | 'recheck' = 'open',
): string {
  const detail: Record<typeof result.reason, string> = {
    unavailable: 'the local menu was not found',
    start: 'the local menu could not start',
    timeout: 'the local menu did not start in time',
    display: 'the menu could not connect to the local display',
    qt: 'the menu could not load its Qt display plugin',
    handoff: 'the running Facepalm tray did not acknowledge the request; quit and reopen Facepalm',
    exit: result.code === undefined ? 'the local menu exited' : `the local menu exited with code ${result.code}`,
    disconnected: 'the local companion is disconnected; reload the window',
    busy: 'another Facepalm settings action is still running',
    inspection: 'the local status check failed',
  };
  return operation === 'recheck'
    ? `Could not recheck Facepalm status: ${detail[result.reason]}. Check Facepalm and try again.`
    : `Could not open Facepalm settings: ${detail[result.reason]}. Try opening settings from the Facepalm menu or tray.`;
}

/** Starts the local settings menu and reports admission or an early failure. */
export async function openFacepalmSettings(
  platform: NodeJS.Platform,
  remote: boolean,
  onLateFailure?: (failure: Extract<FacepalmSettingsLaunch, { state: 'failed' }>) => void,
  onDiagnostic?: (diagnostic: FacepalmSettingsDiagnostic) => void,
): Promise<FacepalmSettingsLaunch> {
  if (remote) return { state: 'failed', reason: 'unavailable' };
  const candidates =
    platform === 'darwin'
      ? [path.join(os.homedir(), 'Applications', 'Facepalm.app')]
      : platform === 'linux'
        ? ['/usr/bin/facepalm-menu', path.join(os.homedir(), '.local', 'facepalm', 'bin', 'facepalm-menu')]
        : [];
  for (const candidate of candidates) {
    try {
      const executable = platform === 'darwin' ? path.join(candidate, 'Contents', 'MacOS', 'facepalm-menu') : candidate;
      if (!(await fs.stat(executable)).isFile()) continue;
      await fs.access(executable, constants.X_OK);
    } catch {
      continue;
    }
    const command = platform === 'darwin' ? '/usr/bin/open' : candidate;
    const args = platform === 'darwin' ? [candidate, '--args', '--settings'] : ['--settings'];
    return new Promise((resolve) => {
      try {
        const child = spawn(command, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let diagnostic = '';
        let spawned = false;
        let settled = false;
        let accepted = false;
        let timer: ReturnType<typeof setTimeout>;
        // The pipe remains drained and unreferenced after admission, so a running menu can log safely.
        child.stderr?.on('data', (chunk: Buffer) => {
          if (diagnostic.length < MAX_DIAGNOSTIC_CHARS) diagnostic += chunk.toString().slice(0, MAX_DIAGNOSTIC_CHARS - diagnostic.length);
        });
        function finish(result: FacepalmSettingsLaunch): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (result.state === 'accepted') {
            accepted = true;
            child.unref();
            const stream = child.stderr;
            if (stream !== null && stream !== undefined) {
              const unref: unknown = Reflect.get(stream, 'unref');
              if (typeof unref === 'function') Reflect.apply(unref, stream, []);
            }
          }
          resolve(result);
        }
        // specs/FacepalmSettingsLaunch.tla, Deadline: no launch may wait forever.
        timer = setTimeout(() => {
          finish({ state: 'failed', reason: 'timeout' });
          try {
            child.kill();
          } catch {
            /* Failure remains a timeout, not an admitted launch. */
          }
        }, SPAWN_TIMEOUT_MS);
        child.once('spawn', () => {
          spawned = true;
          if (platform === 'darwin') return;
          clearTimeout(timer);
          // specs/FacepalmSettingsLaunch.tla, Grace: survival is admission, not a window acknowledgement.
          timer = setTimeout(() => {
            finish({ state: 'accepted' });
          }, STARTUP_GRACE_MS);
        });
        child.once('close', (code, signal) => {
          // specs/FacepalmSettingsLaunch.tla, CleanExit and Fail: a forwarder may exit cleanly.
          if (code === 0 && (spawned || platform === 'darwin')) {
            finish({ state: 'accepted' });
            return;
          }
          const text = diagnostic.toLowerCase();
          const failure: Extract<FacepalmSettingsLaunch, { state: 'failed' }> = text.includes(
            'settings request was not acknowledged by the running tray',
          )
            ? { state: 'failed', reason: 'handoff' }
            : text.includes('could not connect to display') || text.includes('cannot open display')
              ? { state: 'failed', reason: 'display' }
              : text.includes('qt platform plugin')
                ? { state: 'failed', reason: 'qt' }
                : { state: 'failed', reason: 'exit', ...(code === null ? {} : { code }) };
          if (!settled || accepted) {
            try {
              onDiagnostic?.({ reason: failure.reason, signal: diagnosticSignal(signal) });
            } catch {
              /* Diagnostics cannot affect the launcher. */
            }
          }
          if (settled && accepted) {
            try {
              onLateFailure?.(failure);
            } catch {
              /* Observers cannot affect the launcher. */
            }
          } else finish(failure);
        });
        child.once('error', () => {
          finish({ state: 'failed', reason: 'start' });
        });
      } catch {
        resolve({ state: 'failed', reason: 'start' });
      }
    });
  }
  return { state: 'failed', reason: 'unavailable' };
}
