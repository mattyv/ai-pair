// Composed FacepalmClient, a real Unix domain socket standing in for Facepalm's daemon, and the real
// Controller: a beat at a question reaches the pair report with its feeling (#83), and the panel's
// pick of a feeling sends `feel` to the socket. specs/FacepalmSubscription.tla models the lifecycle.

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '@ai-pair/core';
import type { FacepalmCue } from '@ai-pair/protocol';
import { FakeEditor, FakePanel, testConfig, until } from '../../core/test/fake';
import { FacepalmClient } from '../src/facepalm_client';

/** The per-user home directory FacepalmClient looks under; real otherwise, so `net` and `fs` stay real. */
const fakes = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => fakes.home,
}));

/** A real Unix domain socket standing in for Facepalm's daemon, answering just enough of its
 * protocol (`src/protocol.h`, facepalm#61) for this test: `hello`, `beat`, and `feel`. Refuses a
 * `hello` under a name another live connection already holds, as Facepalm's daemon does, while
 * matching the token independently of the name (#138). */
class FakeFacepalmSocket {
  readonly directory: string;
  readonly lines: string[] = [];
  readonly token = randomBytes(32).toString('hex');
  private readonly server: net.Server;
  /** Every live connection, keyed by socket, to its `hello` name once helloed. */
  private readonly connections = new Map<net.Socket, string | undefined>();

  constructor(homeDirectory: string) {
    this.directory = path.join(homeDirectory, '.local', 'state', 'facepalm');
    fs.mkdirSync(path.join(this.directory, 'clients'), { recursive: true });
    fs.writeFileSync(path.join(this.directory, 'clients', 'ai-pair'), this.token, { mode: 0o600 });
    this.server = net.createServer((socket) => {
      this.connections.set(socket, undefined);
      socket.on('close', () => {
        this.connections.delete(socket);
      });
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          this.lines.push(line);
          socket.write(`${this.answer(socket, line)}\n`);
          newline = buffer.indexOf('\n');
        }
      });
    });
  }

  /** Facepalm's reply to one request line, as its daemon would answer it. */
  private answer(socket: net.Socket, line: string): string {
    const words = line.split(' ');
    if (words[0] === 'hello') {
      const [, name, token] = words;
      if (token !== this.token) return '{"error":"a stranger"}';
      if (name !== undefined && [...this.connections.values()].includes(name)) return '{"error":"name already connected"}';
      this.connections.set(socket, name);
      return '{"ok":true}';
    }
    if (words[0] === 'beat') {
      const kind = words[1];
      return JSON.stringify({
        readings: [],
        missed: 0,
        // gaze (facepalm#142) rides along on every interpretation now; ai-pair#143 is this reaching the report.
        interpretation: { id: 1, feeling: 'agreement', beat: kind, feelings: ['agreement', 'disagreement', 'unknown'], gaze: 'on_content' },
      });
    }
    if (words[0] === 'feel') return '{"ok":true}';
    return '{"error":"unknown request"}';
  }

  /** How many connections are live right now, for a test to confirm one closed. */
  get openConnections(): number {
    return this.connections.size;
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(path.join(this.directory, 'service.sock'), resolve);
    });
  }

  close(): Promise<void> {
    for (const socket of this.connections.keys()) socket.destroy();
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

let home: string;
let socket: FakeFacepalmSocket;

const realPlatform = process.platform;

beforeEach(async () => {
  vi.useFakeTimers();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'facepalm-'));
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  fakes.home = home;
  socket = new FakeFacepalmSocket(home);
  await socket.listen();
});

afterEach(async () => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  await socket.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('a beat during a pairing session', () => {
  it('reaches the pair report with the feeling Facepalm sent, then sends feel for the pick made in the panel', async () => {
    const editor = new FakeEditor();
    const panel = new FakePanel();
    const facepalm = new FacepalmClient();
    const controller = new Controller(editor, panel, testConfig, undefined, { facepalm });
    editor.controller = controller;

    await until(controller.start());
    await until(controller.step([{ say: 'Shall I rename this helper?' }]));
    const report = await until(controller.listen());

    expect(socket.lines[0]).toMatch(new RegExp(`^hello ai-pair-\\S+ ${socket.token}$`));
    expect(socket.lines[1]).toBe('beat question 1500');
    const cue = report.batches.find((batch) => batch.facepalm !== undefined)?.facepalm;
    expect(cue).toEqual({ id: 1, feeling: 'agreement', feelings: ['agreement', 'disagreement', 'unknown'], gaze: 'on_content' });
    expect(panel.events).toContainEqual({
      type: 'facepalmCue',
      id: 1,
      feeling: 'agreement',
      feelings: ['agreement', 'disagreement', 'unknown'],
    });

    const picked: FacepalmCue['feeling'] = 'disagreement';
    await until(controller.feelFacepalm(cue?.id ?? 0, picked));
    expect(socket.lines.at(-1)).toBe('feel 1 disagreement');
  });

  it('PassiveInspection: approval recheck stays disconnected and a later beat reconnects after service restart', async () => {
    const client = new FacepalmClient();
    const token = path.join(socket.directory, 'clients', 'ai-pair');
    fs.rmSync(token);
    await until(client.refresh(false));
    expect(client.snapshot().status).toBe('approvalNeeded');
    expect(socket.openConnections).toBe(0);
    fs.writeFileSync(token, socket.token, { mode: 0o600 });
    await until(client.refresh(false));
    expect(client.snapshot().status).toBe('idle');
    expect(socket.openConnections).toBe(0);
    expect(await until(client.markBeat('question', 1))).toMatchObject({ id: 1 });
    const retired = Promise.withResolvers<void>();
    client.onStatus = (snapshot) => {
      if (snapshot.status === 'unchecked') retired.resolve();
    };
    await socket.close();
    await until(retired.promise);
    socket = new FakeFacepalmSocket(home);
    await socket.listen();
    expect(await until(client.markBeat('question', 1))).toMatchObject({ id: 2 });
    await client.dispose();
  });

  it('changes nothing, and never connects, when Facepalm has not approved this name', async () => {
    fs.rmSync(path.join(socket.directory, 'clients', 'ai-pair'));
    const editor = new FakeEditor();
    const panel = new FakePanel();
    const facepalm = new FacepalmClient();
    const controller = new Controller(editor, panel, testConfig, undefined, { facepalm });
    editor.controller = controller;

    await until(controller.start());
    await until(controller.step([{ say: 'Shall I rename this helper?' }]));
    const report = await until(controller.listen());

    expect(socket.lines).toHaveLength(0);
    expect(report.batches.every((batch) => batch.facepalm === undefined)).toBe(true);
    expect(panel.events.some((event) => event.type === 'facepalmCue')).toBe(false);
  });
});

describe('a second VS Code window', () => {
  it('connects at the same time under its own name, instead of being refused as a name already connected (#138)', async () => {
    const first = new FacepalmClient();
    const second = new FacepalmClient();

    const [firstCue, secondCue] = await Promise.all([first.markBeat('question', 1500), second.markBeat('question', 1500)]);

    expect(firstCue?.feeling).toBe('agreement');
    expect(secondCue?.feeling).toBe('agreement');
    const names = socket.lines.filter((line) => line.startsWith('hello ')).map((line) => line.split(' ')[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});

describe('retiring a subscription', () => {
  it('closes the real connection once the programmer ends the session, instead of leaving the camera on (#138)', async () => {
    const editor = new FakeEditor();
    const panel = new FakePanel();
    const facepalm = new FacepalmClient();
    const controller = new Controller(editor, panel, testConfig, undefined, { facepalm });
    editor.controller = controller;

    await until(controller.start());
    await until(controller.step([{ say: 'Shall I rename this helper?' }]));
    await until(controller.listen());
    expect(socket.openConnections).toBe(1);

    // specs/FacepalmSubscription.tla, `Retire`: ending the session closes the subscription, so the
    // camera connection does not outlive it.
    controller.endSession();
    await until(controller.listen());
    // Real timers are faked in this file (`until`'s own trick): advance them so the socket's real
    // close, which runs on the real event loop, gets a turn to be observed.
    for (let elapsed = 0; socket.openConnections > 0 && elapsed < 2000; elapsed += 20) {
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(socket.openConnections).toBe(0);
  });

  it('refuses a feel sent after the session has ended, instead of reconnecting the camera for a card the panel should have closed (#140)', async () => {
    const editor = new FakeEditor();
    const panel = new FakePanel();
    const facepalm = new FacepalmClient();
    const controller = new Controller(editor, panel, testConfig, undefined, { facepalm });
    editor.controller = controller;

    await until(controller.start());
    await until(controller.step([{ say: 'Shall I rename this helper?' }]));
    const played = await until(controller.listen());
    const cue = played.batches.find((batch) => batch.facepalm !== undefined)?.facepalm;
    expect(cue).toBeDefined();
    expect(socket.openConnections).toBe(1);

    // specs/FacepalmSubscription.tla, `Retire`: ending the session closes the real connection.
    controller.endSession();
    await until(controller.listen());
    for (let elapsed = 0; socket.openConnections > 0 && elapsed < 2000; elapsed += 20) {
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(socket.openConnections).toBe(0);
    const linesBeforeFeel = socket.lines.length;

    // `Controller.feelFacepalm` is guarded on a live session, and `FacepalmClient.feel` refuses a
    // retired subscription (`Feel`): neither opens a new connection, nor sends `feel` at all.
    await until(controller.feelFacepalm(cue?.id ?? 0, 'disagreement'));
    expect(socket.openConnections).toBe(0);
    expect(socket.lines).toHaveLength(linesBeforeFeel);
  });
});
