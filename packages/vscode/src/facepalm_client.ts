// A local subscription to Facepalm (github.com/mattyv/facepalm), a camera reaction service outside
// this extension (#83, item 14 of facepalm#61): specs/FacepalmSubscription.tla. Connects to its
// per-user socket, showing the token approved under "ai-pair" (`facepalm-daemon approve ai-pair`),
// but under its own per-instance connection name (one `FacepalmClient` per VS Code window), so a
// second window's connection is never refused as a name already connected (#138). Facepalm matches
// the token independently of the name (its `mcp/session.js` does the same with `mcp-<uuid>`).
// Implements `FacepalmPort` for the controller. Facepalm absent, or the token's name not approved:
// every call resolves to `undefined`, and never throws.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FACEPALM_CLIENT_NAME,
  FACEPALM_DELIVERY_SCHEMA,
  FACEPALM_OK_SCHEMA,
  facepalmBeat,
  facepalmFeel,
  facepalmHello,
  type FacepalmBeatKind,
  type FacepalmCue,
  type FacepalmSnapshot,
} from '@ai-pair/protocol';
import type { FacepalmPort } from '@ai-pair/core';

/** The token's own form: 64 lowercase hex characters (facepalm's `src/client_approvals.h`). */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
/** A token file is read-only to its owner: no group or other access bits. */
const OWNER_ONLY_MODE = 0o077;
/** Longest a connection attempt, a `hello`, or a reply to `feel` may take. */
const SHORT_TIMEOUT_MS = 2000;
/** Bytes in a kibibyte. */
const BYTES_PER_KIBIBYTE = 1024;
/** Longest a reply line may be, so a stray stream can't grow a buffer without bound. */
const MAX_REPLY_KIBIBYTES = 64;
const MAX_REPLY_BYTES = MAX_REPLY_KIBIBYTES * BYTES_PER_KIBIBYTE;

/** An open connection: its socket, and the one reply it is waiting for, if any. */
interface Open {
  socket: net.Socket;
  reader: LineReader;
}

/**
 * Facepalm's fixed per-user directory: `src/user_paths.cc` and `mcp/main.js` compute the same one.
 * `AI_PAIR_FACEPALM_HOME` overrides it, for a real socket a test stands up without touching the real
 * one at this fixed path; Facepalm itself knows nothing of this variable.
 */
function userDirectory(): string {
  const override = process.env.AI_PAIR_FACEPALM_HOME;
  if (override !== undefined) return override;
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Facepalm')
    : path.join(os.homedir(), '.local', 'state', 'facepalm');
}

/** Reads this extension's approved token at `tokenPath`, or `undefined` when it isn't approved. */
async function readToken(tokenPath: string): Promise<string | undefined> {
  try {
    const info = await fs.stat(tokenPath);
    const owned = typeof process.getuid !== 'function' || info.uid === process.getuid();
    if (!info.isFile() || !owned || (info.mode & OWNER_ONLY_MODE) !== 0) return undefined;
    const text = (await fs.readFile(tokenPath, 'utf8')).trim();
    return TOKEN_PATTERN.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Inspects a fixed path without opening the service. */
async function inspect(file: string, socket = false): Promise<'present' | 'absent' | 'unknown'> {
  try {
    const info = await fs.stat(file);
    return socket && !info.isSocket() ? 'unknown' : 'present';
  } catch (error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? 'absent' : 'unknown';
  }
}

/** `JSON.parse`, or `undefined` for text that isn't valid JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Races `promise` against a timeout of `ms`, resolving to `undefined` if it doesn't win. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, ms);
    }),
  ]);
}

/**
 * One open connection's read side: lines of newline-delimited JSON, one reader waiting at a time.
 * `FacepalmClient` never calls `next()` again once a reader has resolved `undefined`: `retire()`
 * discards the connection a failed or closed reader belongs to, so the next exchange gets a fresh one.
 */
class LineReader {
  private buffer = '';
  private waiting: ((line: string | undefined) => void) | undefined;

  constructor(socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > MAX_REPLY_BYTES) {
        this.finish(undefined);
        return;
      }
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.finish(line);
    });
    socket.on('error', () => {
      this.finish(undefined);
    });
    socket.on('close', () => {
      this.finish(undefined);
    });
  }

  /** Resolves the current waiter, if any. */
  private finish(line: string | undefined): void {
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.(line);
  }

  /** Returns the next reply line, or `undefined` once the connection closed or errored. */
  next(): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

/**
 * One local subscription to Facepalm, over its per-user socket (`FacepalmPort`). Connects lazily, on
 * the first beat, and stays open afterwards for later ones. `retire()` closes it, for a session's own
 * end or replacement; only a later beat reopens it (specs/FacepalmSubscription.tla, `Enable`, only
 * from `closed`, which a failed or closed connection returns to at once) - a feeling sent once retired
 * is refused outright, never reconnecting (`Feel`, #140).
 */
export class FacepalmClient implements FacepalmPort {
  private connection: Promise<Open | undefined> | undefined;
  private activeOpen: Open | undefined;
  private pendingSocket: net.Socket | undefined;
  private socketClosed: Promise<void> = Promise.resolve();
  private generation = 0;
  private nextCard = 0;
  private readonly cards = new Map<number, number>();
  private enabled = true;
  private status: FacepalmSnapshot['status'] = 'unchecked';
  private available = true;
  private canOpenSettings = false;
  private remote = false;
  private refreshGeneration = 0;
  /** Receives current snapshots after changes. */
  onStatus: ((snapshot: FacepalmSnapshot) => void) | undefined;

  /** Returns the current observed state without opening a connection. */
  snapshot(): FacepalmSnapshot {
    return { enabled: this.enabled, status: this.status, available: this.available, canOpenSettings: this.canOpenSettings };
  }

  /** Inspects local files without connecting to Facepalm or starting its camera. */
  async refresh(remote: boolean, remoteHost = remote, notify = true): Promise<void> {
    this.remote = remote;
    const generation = this.generation;
    const refreshGeneration = ++this.refreshGeneration;
    const directory = userDirectory();
    const appPaths =
      process.platform === 'darwin'
        ? [path.join(os.homedir(), 'Applications', 'Facepalm.app')]
        : process.platform === 'linux'
          ? ['/usr/bin/facepalm-menu', path.join(os.homedir(), '.local', 'facepalm', 'bin', 'facepalm-menu')]
          : [];
    const [socket, token, ...apps] = await Promise.all([
      inspect(path.join(directory, 'service.sock'), true),
      inspect(path.join(directory, 'clients', FACEPALM_CLIENT_NAME)),
      ...appPaths.map((file) => inspect(file)),
    ]);
    if (generation !== this.generation || refreshGeneration !== this.refreshGeneration || remote !== this.remote) return;
    const executables = appPaths.map((candidate) =>
      process.platform === 'darwin' ? path.join(candidate, 'Contents', 'MacOS', 'facepalm-menu') : candidate,
    );
    const launchable = await Promise.all(
      executables.map(async (file) => {
        try {
          const info = await fs.stat(file);
          if (!info.isFile()) return false;
          await fs.access(file, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    );
    if (generation !== this.generation || refreshGeneration !== this.refreshGeneration || remote !== this.remote) return;
    this.canOpenSettings = !remoteHost && launchable.includes(true);
    this.available = remoteHost || appPaths.length === 0 || [socket, token, ...apps].some((value) => value !== 'absent');
    if (!this.enabled) {
      this.publish('off', notify);
      return;
    }
    if (this.status === 'connected') {
      this.available = true;
      this.publish('connected', notify);
      return;
    }
    if (socket === 'absent') this.publish(remote ? 'unavailableSsh' : 'notRunning', notify);
    else if (socket === 'present' && token === 'absent') this.publish('approvalNeeded', notify);
    else if (socket === 'present' && token === 'present') {
      const approved = await readToken(path.join(directory, 'clients', FACEPALM_CLIENT_NAME));
      if (
        generation === this.generation &&
        refreshGeneration === this.refreshGeneration &&
        remote === this.remote &&
        this.enabled &&
        this.snapshot().status !== 'connected'
      ) {
        this.publish(approved === undefined ? 'unchecked' : 'idle', notify);
      }
    } else this.publish('unchecked', notify);
  }

  /** Publishes an observed status to the panel. */
  private publish(status: FacepalmSnapshot['status'], notify = true): void {
    this.status = status;
    if (!notify) return;
    try {
      this.onStatus?.(this.snapshot());
    } catch {
      /* Observers cannot interrupt ownership. */
    }
  }

  /** Changes whether new Facepalm work is admitted. */
  setEnabled(enabled: boolean): void {
    // specs/FacepalmSettings.tla, Enable and Disable: change desired admission.
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.retire();
      this.publish('off');
    } else this.publish('unchecked');
  }

  /** Serializes every exchange on the connection: it answers one line at a time, in order. */
  private tail: Promise<unknown> = Promise.resolve();
  /**
   * This instance's own connection name, distinct from every other window's (#138): the approved
   * token is still read from the fixed `FACEPALM_CLIENT_NAME`, which `hello` never sends.
   */
  private readonly name = `${FACEPALM_CLIENT_NAME}-${randomUUID()}`;
  /**
   * Set by `retire()`, cleared by `markBeat()`: specs/FacepalmSubscription.tla's `retired`. Guards
   * `feel()` against reconnecting a retired subscription just to carry a feeling for a card the
   * panel should already have disabled (#140); only a new beat may reconnect it.
   */
  private retired = false;

  /**
   * Sends `command` and returns its reply line, racing `timeoutMs`; `undefined` closes the
   * connection. Never rejects, including on the one before it in the queue: a write that throws,
   * on an unlucky socket, answers this request with `undefined` and still lets the next one through.
   */
  private request(command: string, timeoutMs: number, generation: number, allowConnect = true): Promise<string | undefined> {
    const turn = this.tail
      .then(async () => {
        if (!this.enabled || generation !== this.generation) return undefined;
        const open = await (allowConnect ? this.connect(generation) : this.connection);

        if (open === undefined || !this.enabled || generation !== this.generation) return undefined;
        open.socket.write(`${command}\n`);
        const reply = await withTimeout(open.reader.next(), timeoutMs);
        if (generation !== this.generation || !this.enabled) return undefined;
        if (reply === undefined) this.retire();
        return reply;
      })
      .catch(() => undefined);
    this.tail = turn;
    return turn;
  }

  /** Opens the connection if it isn't already open or opening; a failed attempt may be retried later. */
  private connect(generation: number): Promise<Open | undefined> {
    if (this.connection === undefined) {
      const opening = this.open(generation).catch(() => {
        if (generation === this.generation) this.pendingSocket?.destroy();
        return undefined;
      });
      this.connection = opening;
      void opening.then((open) => {
        if (open === undefined && this.connection === opening) this.connection = undefined;
      });
    }
    return this.connection;
  }

  private async open(generation: number): Promise<Open | undefined> {
    const directory = userDirectory();
    const token = await readToken(path.join(directory, 'clients', FACEPALM_CLIENT_NAME));
    if (token === undefined || !this.enabled || generation !== this.generation) return undefined;
    // specs/FacepalmSettings.tla, Close: retain the physical slot until close is observed.
    await this.socketClosed;
    if (!this.enabled || generation !== this.generation) return undefined;
    const socket = net.createConnection(path.join(directory, 'service.sock'));
    this.pendingSocket = socket;
    this.socketClosed = new Promise((resolve) => {
      socket.once('close', () => {
        resolve();
      });
    });
    const connected = await withTimeout(
      new Promise<boolean>((resolve) => {
        socket.once('connect', () => {
          resolve(true);
        });
        socket.once('error', () => {
          resolve(false);
        });
      }),
      SHORT_TIMEOUT_MS,
    );
    if (connected !== true || !this.enabled || generation !== this.generation) {
      socket.destroy();
      if (this.pendingSocket === socket) this.pendingSocket = undefined;
      return undefined;
    }
    const reader = new LineReader(socket);
    socket.write(`${facepalmHello(this.name, token)}\n`);
    const hello = await withTimeout(reader.next(), SHORT_TIMEOUT_MS);
    if (hello === undefined || !this.enabled || generation !== this.generation || !FACEPALM_OK_SCHEMA.safeParse(parseJson(hello)).success) {
      socket.destroy();
      if (this.pendingSocket === socket) this.pendingSocket = undefined;
      return undefined;
    }
    this.pendingSocket = undefined;
    // specs/FacepalmSettings.tla, Connect: accept only this generation's hello.
    const open: Open = { socket, reader };
    this.activeOpen = open;
    socket.once('close', () => {
      if (this.activeOpen === open) this.retire();
    });
    this.publish('connected');
    return open;
  }

  /**
   * Closes the connection, discarding any beat it left unanswered, and marks this subscription
   * retired (specs/FacepalmSubscription.tla, `Retire`): a later `feel()` is refused until `markBeat()`
   * reconnects it (#140).
   */
  retire(): void {
    // specs/FacepalmSettings.tla, Retire: invalidate cards and pending work.
    this.generation++;
    this.activeOpen = undefined;
    this.cards.clear();
    this.pendingSocket?.destroy();
    this.pendingSocket = undefined;
    void this.connection?.then((open) => open?.socket.destroy());
    this.connection = undefined;
    this.retired = true;
    if (this.enabled) this.publish('unchecked');
  }

  /** Retires this client and waits for its last physical socket to close. */
  dispose(): Promise<void> {
    // specs/LocalFacepalm.tla, Close: replacement ownership waits for actual socket closure.
    this.retire();
    return this.socketClosed;
  }

  async markBeat(kind: FacepalmBeatKind, windowMs: number): Promise<FacepalmCue | undefined> {
    // specs/FacepalmSubscription.tla, `Enable`: a new beat always may reconnect a retired
    // subscription (#140), unlike `feel()` below.
    if (!this.enabled) return undefined;
    this.retired = false;
    // specs/FacepalmSettings.tla, Beat and Answer: accept only current replies.
    const generation = this.generation;
    const reply = await this.request(facepalmBeat(kind, windowMs), windowMs + SHORT_TIMEOUT_MS, generation);
    if (reply === undefined || generation !== this.generation || !this.enabled) return undefined;
    const parsed = FACEPALM_DELIVERY_SCHEMA.safeParse(parseJson(reply));
    if (!parsed.success || parsed.data.interpretation === undefined) return undefined;
    const { id, feeling, feelings, gaze } = parsed.data.interpretation;
    const card = ++this.nextCard;
    this.cards.set(card, id);
    return { id: card, feeling, feelings, gaze };
  }

  /**
   * Tells Facepalm how the programmer felt at a beat it already delivered (#83). Refused outright,
   * without connecting, once this subscription is retired (specs/FacepalmSubscription.tla, `Feel`):
   * only a new beat reconnects a retired subscription, never a feeling for a card the panel should
   * already have disabled (#140).
   */
  async feel(id: number, feeling: FacepalmCue['feeling']): Promise<void> {
    const daemonId = this.cards.get(id);
    if (this.retired || !this.enabled || daemonId === undefined) return;
    this.cards.delete(id);
    await this.request(facepalmFeel(daemonId, feeling), SHORT_TIMEOUT_MS, this.generation, false);
  }
}
