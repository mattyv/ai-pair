import { afterEach, describe, expect, it } from 'vitest';
import { deadline } from './scripted_agent_harness';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Bridge, Controller, type NarrationPort } from '@ai-pair/core';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import { FakeEditor, FakePanel, testConfig } from '../../core/test/fake';
import { EditorLink } from '../src/link';
import { createServer } from '../src/server';

function noop(): void {}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

/** Builds a real MCP-to-websocket path with a deterministic in-memory editor. */
async function setup(seed: number, narration?: NarrationPort) {
  const trace: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-script-'));
  const editor = new FakeEditor();
  const panel = new FakePanel();
  editor.files.set(editor.resolvePath('src/a.ts'), '');
  const controller = new Controller(
    editor,
    panel,
    {
      ...testConfig,
      timing: { ...testConfig.timing, reading: { msPerChar: 0, minMs: 1 }, beforeMoveMs: 1 },
    },
    narration,
  );
  editor.controller = controller;
  const bridge = new Bridge(controller, {
    dir,
    runtime: { version: 'test', build: 'test', relayHash: 'test' },
    workspaceFolders: () => ['/project'],
    calibrate: () => true,
    trace: (line) => {
      trace.push(line);
    },
  });
  const clients: Client[] = [];
  const links: EditorLink[] = [];
  const servers: Array<ReturnType<typeof createServer>> = [];
  cleanup.push(async () => {
    controller.endSession();
    for (const client of clients) await client.close();
    for (const server of servers) await server.close();
    for (const link of links) link.close();
    bridge.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await bridge.start();
  async function connect(): Promise<Client> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const link = new EditorLink('/project/src', dir);
    links.push(link);
    const server = createServer(link, 'GUIDE', '/project/src');
    servers.push(server);
    await server.connect(serverSide);
    const client = new Client({ name: 'scripted-agent', version: '0' });
    await client.connect(clientSide);
    clients.push(client);
    return client;
  }
  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    trace.push(`script ${name}`);
    const result = await deadline(client.callTool({ name, arguments: args }), 2000, seed, trace);
    expect(result.isError, `seed ${seed}; trace: ${trace.join(' -> ')}; result: ${JSON.stringify(result)}`).not.toBe(true);
    const text = result.content;
    expect(Array.isArray(text)).toBe(true);
    return JSON.stringify(text);
  }
  async function waitFor(label: string, predicate: () => boolean) {
    trace.push(`wait ${label}`);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await deadline(
        new Promise<void>((resolve) => {
          function check() {
            if (predicate()) resolve();
          }
          check();
          timer = setInterval(check, 5);
        }),
        2000,
        seed,
        trace,
      );
    } finally {
      clearInterval(timer);
    }
  }
  return { bridge, controller, editor, panel, connect, call, waitFor, trace };
}

describe('continued speech flow', () => {
  it('cancels outstanding continued speech when the agent ends', async () => {
    const speech = Promise.withResolvers<void>();
    let canceled = false;
    const narration: NarrationPort = {
      speak: () => speech.promise,
      attentionCue: () => Promise.resolve(),
      pause: noop,
      resume: noop,
      cancel: () => {
        canceled = true;
        speech.resolve();
      },
    };
    const h = await setup(202, narration);
    const client = await h.connect();
    await h.call(client, 'start');
    await h.call(client, 'step', { actions: [{ say: 'Working.', speech_mode: 'continue' }] });
    await h.call(client, 'end');
    expect(canceled).toBe(true);
  });

  it('types during continued speech and drains a waiting question before reply', async () => {
    const first = Promise.withResolvers<void>();
    const question = Promise.withResolvers<void>();
    const spoken: string[] = [];
    const narration: NarrationPort = {
      speak: (text) => {
        spoken.push(text);
        return spoken.length === 1 ? first.promise : question.promise;
      },
      attentionCue: () => Promise.resolve(),
      pause: noop,
      resume: noop,
      cancel: () => {
        first.resolve();
        question.resolve();
      },
    };
    const h = await setup(201, narration);
    const client = await h.connect();
    await h.call(client, 'start');
    await h.call(client, 'step', {
      actions: [
        { say: 'Working.', speech_mode: 'continue' },
        { move: { file: 'a.ts', line: 1, to: 'line_end' } },
        { type: `x${CURSOR_MARKER}` },
        { say: 'Question?' },
      ],
    });
    await h.waitFor('typing during speech', () => h.editor.text('src/a.ts') === 'x');
    expect(spoken).toEqual(['Working.']);
    first.resolve();
    await h.waitFor('question spoken', () => spoken.length === 2);
    const pending = h.call(client, 'listen');
    let returned = false;
    void pending.then(() => {
      returned = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(returned).toBe(false);
    question.resolve();
    await h.waitFor('question finished', () => h.panel.events.some((event) => event.type === 'state' && event.state === 'listening'));
    h.controller.userMessage('answer');
    const reply = await pending;
    expect(reply).toContain('answer');
    await h.call(client, 'end');
  });
});
