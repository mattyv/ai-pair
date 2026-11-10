import type { DiagnosticEvent } from '@ai-pair/core';
import type { PauseReason } from '@ai-pair/protocol';
import type { LocalSpeechFailureReason } from './speech_types';

/** Maximum number of recent lifecycle events copied in a report. */
export const MAX_DIAGNOSTIC_EVENTS = 100;

/** Speech facts are fixed enums only; no voice IDs, text or secrets. */
export interface SpeechDiagnosticEvent {
  kind: 'speech';
  event: 'preview' | 'catalog' | 'setup' | 'capability' | 'runtime' | 'narration';
  phase: 'received' | 'blocked' | 'dispatched' | 'ready' | 'failed';
  provider: 'kokoro' | 'elevenlabs' | 'unknown';
  reason?: SpeechDiagnosticReason;
}
export type SpeechDiagnosticReason =
  | 'unsupported'
  | 'host_platform'
  | 'host_arch'
  | 'libc_unknown'
  | 'libc_report_failed'
  | 'no_key'
  | 'no_voice'
  | 'not_ready'
  | 'auth'
  | 'rate'
  | 'network'
  | 'timeout'
  | 'invalid'
  | 'canceled'
  | 'unknown'
  | LocalSpeechFailureReason;
type StoredEvent = (DiagnosticEvent | SpeechDiagnosticEvent) & { seq: number; time: number };
type SessionState = 'idle' | 'active' | 'suspended' | 'ended' | 'unavailable';
type ConnectionState = 'connected' | 'disconnected' | 'unavailable';

/** A snapshot contains only explicitly selected lifecycle facts. */
export interface DiagnosticSnapshot {
  version: string;
  build: string;
  session: SessionState;
  connection: ConnectionState;
  connectionId: number | 'unavailable';
  paused: boolean | 'unavailable';
  pauseReasons: PauseReason[] | 'unavailable';
  events: StoredEvent[];
}

const SESSION = new Set(['active', 'suspended', 'ended']);
const CONNECTION = new Set(['connected', 'disconnected']);
const PAUSE_REASON = new Set(['programmer', 'reply', 'away', 'calibrate']);
const REQUEST_METHOD = new Set(['start', 'step', 'listen', 'end', 'read', 'calibrate', 'diagnostics', 'unknown']);
const REQUEST_PHASE = new Set(['received', 'replied', 'failed', 'cancelled']);
const SPEECH_EVENT = new Set(['preview', 'catalog', 'setup', 'capability', 'runtime', 'narration']);
const SPEECH_PHASE = new Set(['received', 'blocked', 'dispatched', 'ready', 'failed']);
const SPEECH_PROVIDER = new Set(['kokoro', 'elevenlabs', 'unknown']);
const SPEECH_REASON = new Set([
  'unsupported',
  'host_platform',
  'host_arch',
  'libc_unknown',
  'libc_report_failed',
  'no_key',
  'no_voice',
  'not_ready',
  'auth',
  'rate',
  'network',
  'timeout',
  'invalid',
  'canceled',
  'unknown',
  'runtime_missing',
  'model_missing',
  'worker_module',
  'worker_native',
  'worker_permission',
  'worker_error',
  'worker_exit',
  'model_load',
  'synthesis',
  'audio_page',
]);
const COMMAND_PHASE = new Set(['start', 'timeout', 'abort', 'closed', 'untracked', 'failed']);

/** Restricts runtime identity to the build system's short identifier format. */
function identity(value: string): string {
  return /^[a-zA-Z0-9._+-]{1,64}$/.test(value) ? value : 'unavailable';
}

/** Returns whether a numeric identifier can be represented without ambiguity. */
function validId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Stores a bounded, allowlisted history without arbitrary source text. */
export class Diagnostics {
  private readonly version: string;
  private readonly build: string;
  private session: SessionState = 'unavailable';
  private connection: ConnectionState = 'unavailable';
  private connectionId: number | 'unavailable' = 'unavailable';
  private paused: boolean | 'unavailable' = 'unavailable';
  private pauseReasons: PauseReason[] | 'unavailable' = 'unavailable';
  private sequence = 0;
  private readonly events: StoredEvent[] = [];

  constructor(info: { version: string; build: string }) {
    this.version = identity(info.version);
    this.build = identity(info.build);
  }

  /** Records only the known properties of a valid lifecycle event. */
  record(event: DiagnosticEvent | SpeechDiagnosticEvent): void {
    let selected: DiagnosticEvent | SpeechDiagnosticEvent;
    switch (event.kind) {
      case 'speech':
        if (
          !SPEECH_EVENT.has(event.event) ||
          !SPEECH_PHASE.has(event.phase) ||
          !SPEECH_PROVIDER.has(event.provider) ||
          (event.reason !== undefined && !SPEECH_REASON.has(event.reason))
        ) {
          return;
        }
        selected = {
          kind: 'speech',
          event: event.event,
          phase: event.phase,
          provider: event.provider,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        };
        break;
      case 'session':
        if (!SESSION.has(event.state)) return;
        selected = { kind: 'session', state: event.state };
        this.session = event.state;
        break;
      case 'connection':
        if (!CONNECTION.has(event.state) || !validId(event.connectionId)) return;
        selected = { kind: 'connection', state: event.state, connectionId: event.connectionId };
        this.connection = event.state;
        this.connectionId = event.connectionId;
        break;
      case 'pause':
        if (
          typeof event.paused !== 'boolean' ||
          !Array.isArray(event.reasons) ||
          event.reasons.length > PAUSE_REASON.size ||
          event.reasons.some((reason) => !PAUSE_REASON.has(reason)) ||
          event.paused !== event.reasons.length > 0
        ) {
          return;
        }
        selected = { kind: 'pause', paused: event.paused, reasons: [...event.reasons] };
        this.paused = event.paused;
        this.pauseReasons = [...event.reasons];
        break;
      case 'request':
        if (!validId(event.id) || !validId(event.connectionId) || !REQUEST_METHOD.has(event.method) || !REQUEST_PHASE.has(event.phase)) {
          return;
        }
        selected = { kind: 'request', connectionId: event.connectionId, id: event.id, method: event.method, phase: event.phase };
        break;
      case 'command':
        if (!validId(event.id)) return;
        if (event.phase === 'requested') {
          if (!Number.isFinite(event.waitMs) || event.waitMs < 0) return;
          selected = { kind: 'command', id: event.id, phase: 'requested', waitMs: event.waitMs };
        } else if (event.phase === 'integration') {
          if (typeof event.available !== 'boolean') return;
          selected = { kind: 'command', id: event.id, phase: 'integration', available: event.available };
        } else if (event.phase === 'end') {
          if (event.exitCode !== undefined && !Number.isSafeInteger(event.exitCode)) return;
          selected = { kind: 'command', id: event.id, phase: 'end', ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }) };
        } else {
          if (!COMMAND_PHASE.has(event.phase)) return;
          selected = { kind: 'command', id: event.id, phase: event.phase };
        }
        break;
      default:
        return;
    }
    // specs/DiagnosticsPrivacy.tla, Record: retain only the selected fields.
    this.events.push({ ...selected, seq: ++this.sequence, time: Date.now() });
    if (this.events.length > MAX_DIAGNOSTIC_EVENTS) this.events.shift();
  }

  /** Copies the current state and retained events without exposing the buffer. */
  snapshot(): DiagnosticSnapshot {
    // specs/DiagnosticsPrivacy.tla, Copy: the copy does not mutate history.
    return {
      version: this.version,
      build: this.build,
      session: this.session,
      connection: this.connection,
      connectionId: this.connectionId,
      paused: this.paused,
      pauseReasons: this.pauseReasons === 'unavailable' ? 'unavailable' : [...this.pauseReasons],
      events: this.events.map((event) => (event.kind === 'pause' ? { ...event, reasons: [...event.reasons] } : { ...event })),
    };
  }
}
