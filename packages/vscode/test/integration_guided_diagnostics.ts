// Runs inside an isolated VS Code against the packaged extension.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WebSocketServer } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CURSOR_MARKER,
  DIAGNOSTIC_SNAPSHOT_SCHEMA,
  DISCOVERY_SCHEMA,
  parseRelayMessage,
  PROTOCOL_VERSION,
  type RelayMessage,
} from '@ai-pair/protocol';
import type { Bridge } from '../../core/src/bridge';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

function isApi(value: unknown): value is Api {
  return (
    typeof value === 'object' && value !== null && 'launcher' in value && 'controller' in value && 'bridge' in value && 'ready' in value
  );
}

/** Exercises collector failures and bounded diagnostic peers through the loaded bridge and relay. */
async function diagnosticFailurePaths(
  api: Api,
  connect: (home?: string, cwd?: string) => Promise<Client>,
  textSchema: z.ZodType<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-diagnostic-'));
  try {
    const folder = path.join(home, 'workspace');
    const windows = path.join(home, 'windows');
    fs.mkdirSync(folder);
    fs.mkdirSync(windows);
    const discovery = DISCOVERY_SCHEMA.parse(JSON.parse(fs.readFileSync(api.bridge.file, 'utf8')));
    assert.ok(discovery.runtime);
    // The extension bundles its own Bridge class; use that instance's constructor, not a test bundle copy.
    const prototype: unknown = Object.getPrototypeOf(api.bridge);
    assert.ok(typeof prototype === 'object' && prototype !== null && 'constructor' in prototype);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const BridgeConstructor = prototype.constructor as typeof Bridge;
    let collectorThrows = true;
    const bridge = new BridgeConstructor(api.controller, {
      dir: windows,
      workspaceFolders: () => [folder],
      runtime: discovery.runtime,
      calibrate: () => false,
      collectDiagnostics: () =>
        collectorThrows ? Promise.reject(new Error('private collector failure')) : Promise.resolve({ secret: 'private' }),
    });
    let client: Client | undefined;
    try {
      await bridge.start();
      client = await connect(home, folder);
      for (const throws of [true, false]) {
        collectorThrows = throws;
        const result = textSchema.parse(await client.callTool({ name: 'diagnostics', arguments: { cwd: folder } }));
        assert.equal(result.isError, true);
        assert.equal(result.content[0]?.text, 'internal: Diagnostics failed.');
        assert.equal(api.controller.isActive, false);
      }
      await client.close();
      client = undefined;
      bridge.dispose();
      for (const welcome of [false, true]) {
        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        try {
          await new Promise<void>((resolve) => {
            server.once('listening', resolve);
          });
          const address = server.address();
          assert.ok(typeof address === 'object' && address !== null);
          const closed = Promise.withResolvers<void>();
          const received: RelayMessage[] = [];
          server.on('connection', (socket) => {
            socket.once('close', () => {
              closed.resolve();
            });
            socket.on('message', (data) => {
              assert.ok(Buffer.isBuffer(data));
              const frame = parseRelayMessage(data);
              assert.ok(frame);
              received.push(frame);
              if (welcome && frame.type === 'hello') socket.send(JSON.stringify({ type: 'welcome' }));
            });
          });
          fs.writeFileSync(
            path.join(windows, `${process.pid}.json`),
            JSON.stringify({
              pid: process.pid,
              workspaceFolders: [folder],
              port: address.port,
              token: 'fake',
              protocolVersion: PROTOCOL_VERSION,
              runtime: discovery.runtime,
              lastFocused: Date.now(),
            }),
          );
          client = await connect(home, folder);
          const result = textSchema.parse(await client.callTool({ name: 'diagnostics', arguments: { cwd: folder } }));
          assert.equal(result.isError, true);
          assert.equal(result.content[0]?.text, 'timeout: The diagnostics request timed out.');
          assert.deepEqual(
            received.map(({ type }) => type),
            welcome ? ['hello', 'call'] : ['hello'],
          );
          if (welcome) {
            const call = received[1];
            assert.equal(call?.type, 'call');
            assert.equal(call.tool, 'diagnostics');
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              closed.promise,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  reject(new Error('Diagnostic peer was not closed'));
                }, 2000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          await client.close();
          client = undefined;
        } finally {
          try {
            await client?.close();
          } finally {
            client = undefined;
            for (const socket of server.clients) socket.terminate();
            await new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            });
            fs.rmSync(path.join(windows, `${process.pid}.json`), { force: true });
          }
        }
      }
    } finally {
      try {
        await client?.close();
      } finally {
        bridge.dispose();
      }
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Exercises packaged MCP prompts, diagnostics isolation, and a saved Pair edit. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('michalstrba.ai-pair');
  assert.ok(extension);
  const api: unknown = await extension.activate();
  if (!isApi(api)) throw new Error('Extension API unavailable');
  await api.ready;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root === undefined) throw new Error('Workspace unavailable');
  assert.equal(api.controller.isActive, false, 'diagnostics fixture requires an idle session');
  const launcher = api.launcher;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  async function connect(home?: string, cwd = root): Promise<Client> {
    const client = new Client({ name: 'guided-smoke', version: '1' });
    await client.connect(
      new StdioClientTransport({ command: launcher, cwd, env: home === undefined ? env : { ...env, AI_PAIR_HOME: home } }),
    );
    return client;
  }
  const textSchema = z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
    isError: z.boolean().optional(),
  });
  async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = textSchema.parse(await client.callTool({ name, arguments: args }));
    assert.notEqual(result.isError, true, result.content.map((part) => part.text).join('\n'));
    return result.content.map((part) => part.text).join('\n');
  }
  const directory = fs.mkdtempSync(path.join(root, 'ai-pair-smoke-'));
  const relative = path.basename(directory);
  let owner: Client | undefined;
  let observer: Client | undefined;
  try {
    owner = await connect();
    observer = await connect();
    for (const name of ['demo', 'diagnose']) {
      const prompt = await owner.getPrompt({ name });
      const content = z.object({ type: z.literal('text'), text: z.string() }).parse(prompt.messages[0]?.content);
      assert.equal(content.text, fs.readFileSync(path.join(extension.extensionPath, 'skills', `ai-pair-${name}`, 'SKILL.md'), 'utf8'));
    }
    for (const { task, expected } of [
      { task: '', expected: "Ask me what we're working on" },
      { task: '  inspect the test  ', expected: 'The task: inspect the test' },
    ]) {
      const prompt = await owner.getPrompt({ name: 'start', arguments: { task } });
      const content = z.object({ type: z.literal('text'), text: z.string() }).parse(prompt.messages[0]?.content);
      assert.ok(content.text.includes(expected));
    }
    const invalid = textSchema.parse(await observer.callTool({ name: 'diagnostics', arguments: { cwd: 'relative' } }));
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0]?.text ?? '', /^invalid_cwd:/);
    const missing = textSchema.parse(await observer.callTool({ name: 'diagnostics', arguments: { cwd: path.dirname(root) } }));
    assert.equal(missing.isError, true);
    assert.match(missing.content[0]?.text ?? '', /^no_editor:/);
    const idle = DIAGNOSTIC_SNAPSHOT_SCHEMA.parse(JSON.parse(await call(observer, 'diagnostics')));
    assert.ok(idle.session === 'idle' || idle.session === 'ended', `expected an inactive session, got ${idle.session}`);
    assert.equal(api.controller.isActive, false);
    api.controller.setSpeed(20);
    api.controller.setReadingSpeed(10);
    api.controller.setConfirmCommands(false);
    const scratch = path.join(directory, 'scratch.txt');
    const scratchFile = `${relative}/scratch.txt`;
    fs.writeFileSync(scratch, 'start\n');
    await call(owner, 'start', { task: 'Verify a scratch edit', cwd: root });
    await call(owner, 'read', { file: scratchFile });
    await call(owner, 'step', {
      actions: [
        { say: 'I will add a marker and check the saved file.' },
        { move: { file: scratchFile, line: 1, to: 'line_end' } },
        { type: ` verified${CURSOR_MARKER}` },
        { run: `cat ${relative}/scratch.txt > ${relative}/result.txt`, wait: 2 },
      ],
    });
    const finished = await call(owner, 'step', { actions: [] });
    assert.match(finished, /completed/i);
    assert.equal(fs.readFileSync(scratch, 'utf8'), 'start verified\n');
    assert.equal(fs.readFileSync(path.join(directory, 'result.txt'), 'utf8'), 'start verified\n');
    api.controller.userMessage('queued while diagnostics runs');
    const active = DIAGNOSTIC_SNAPSHOT_SCHEMA.parse(JSON.parse(await call(observer, 'diagnostics')));
    assert.equal(active.session, 'active');
    await observer.close();
    observer = undefined;
    assert.equal(api.controller.isActive, true);
    assert.equal(api.controller.isSuspended, false);
    assert.match(await call(owner, 'listen'), /queued while diagnostics runs/);
    await call(owner, 'end', { summary: 'Scratch verification complete.' });
    assert.equal(api.controller.isActive, false, 'end must retire the owner session');
    await diagnosticFailurePaths(api, connect, textSchema);
    console.log('GUIDED_SMOKE_OK packaged prompts, idle and active diagnostics, isolated owner, saved edit and command');
  } finally {
    try {
      await observer?.close();
    } finally {
      try {
        await owner?.close();
      } finally {
        if (api.controller.isActive) api.controller.endSession();
        fs.rmSync(directory, { recursive: true, force: true });
        assert.equal(api.controller.isActive, false, 'diagnostics fixture must leave no active session');
      }
    }
  }
}
