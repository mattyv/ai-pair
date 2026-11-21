// A local subscription to Facepalm (github.com/mattyv/facepalm), a camera reaction service outside
// this extension (#83, item 14 of facepalm#61): specs/FacepalmSubscription.tla. Connects to its
// per-user socket under the name this extension approves itself as, "ai-pair"
// (`facepalm-daemon approve ai-pair`), and implements `FacepalmPort` for the controller. Facepalm
// absent, or this name not approved: every call resolves to `undefined`, and never throws.

import * as fs from 'node:fs/promises';
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

/** Facepalm's fixed per-user directory: `src/user_paths.cc` and `mcp/main.js` compute the same one. */
function userDirectory(): string {
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
 * the first beat or feeling, and stays open afterwards for later ones. `retire()` closes it, for the
 * extension's own shutdown; a later call reopens it (specs/FacepalmSubscription.tla, `Enable`, only
 * from `closed`, which a failed or closed connection returns to at once).
 */
export class FacepalmClient implements FacepalmPort {
  private connection: Promise<Open | undefined> | undefined;
  /** Serializes every exchange on the connection: it answers one line at a time, in order. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Sends `command` and returns its reply line, racing `timeoutMs`; `undefined` closes the
   * connection. Never rejects, including on the one before it in the queue: a write that throws,
   * on an unlucky socket, answers this request with `undefined` and still lets the next one through.
   */
  private request(command: string, timeoutMs: number): Promise<string | undefined> {
    const turn = this.tail
      .then(async () => {
        const open = await this.connect();
        if (open === undefined) return undefined;
        open.socket.write(`${command}\n`);
        const reply = await withTimeout(open.reader.next(), timeoutMs);
        if (reply === undefined) this.retire();
        return reply;
      })
      .catch(() => undefined);
    this.tail = turn;
    return turn;
  }

  /** Opens the connection if it isn't already open or opening; a failed attempt may be retried later. */
  private connect(): Promise<Open | undefined> {
    if (this.connection === undefined) {
      const opening = this.open();
      this.connection = opening;
      void opening.then((open) => {
        if (open === undefined && this.connection === opening) this.connection = undefined;
      });
    }
    return this.connection;
  }

  private async open(): Promise<Open | undefined> {
    const directory = userDirectory();
    const token = await readToken(path.join(directory, 'clients', FACEPALM_CLIENT_NAME));
    if (token === undefined) return undefined;
    const socket = net.createConnection(path.join(directory, 'service.sock'));
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
    if (connected !== true) {
      socket.destroy();
      return undefined;
    }
    const reader = new LineReader(socket);
    socket.write(`${facepalmHello(FACEPALM_CLIENT_NAME, token)}\n`);
    const hello = await withTimeout(reader.next(), SHORT_TIMEOUT_MS);
    if (hello === undefined || !FACEPALM_OK_SCHEMA.safeParse(parseJson(hello)).success) {
      socket.destroy();
      return undefined;
    }
    const open: Open = { socket, reader };
    socket.once('close', () => {
      void this.connection?.then((current) => {
        if (current === open) this.connection = undefined;
      });
    });
    return open;
  }

  /** Closes the connection, discarding any beat it left unanswered. A later call reopens it. */
  retire(): void {
    void this.connection?.then((open) => open?.socket.destroy());
    this.connection = undefined;
  }

  async markBeat(kind: FacepalmBeatKind, windowMs: number): Promise<FacepalmCue | undefined> {
    const reply = await this.request(facepalmBeat(kind, windowMs), windowMs + SHORT_TIMEOUT_MS);
    if (reply === undefined) return undefined;
    const parsed = FACEPALM_DELIVERY_SCHEMA.safeParse(parseJson(reply));
    if (!parsed.success || parsed.data.interpretation === undefined) return undefined;
    const { id, feeling, feelings } = parsed.data.interpretation;
    return { id, feeling, feelings };
  }

  async feel(id: number, feeling: FacepalmCue['feeling']): Promise<void> {
    await this.request(facepalmFeel(id, feeling), SHORT_TIMEOUT_MS);
  }
}
