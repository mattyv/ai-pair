// Runs inside an isolated VS Code against the packaged extension.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CURSOR_MARKER, DIAGNOSTIC_SNAPSHOT_SCHEMA } from '@ai-pair/protocol';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

function isApi(value: unknown): value is Api {
  return typeof value === 'object' && value !== null && 'launcher' in value && 'controller' in value && 'ready' in value;
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
  const launcher = api.launcher;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  async function connect(): Promise<Client> {
    const client = new Client({ name: 'guided-smoke', version: '1' });
    await client.connect(new StdioClientTransport({ command: launcher, cwd: root, env }));
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
    const idle = DIAGNOSTIC_SNAPSHOT_SCHEMA.parse(JSON.parse(await call(observer, 'diagnostics')));
    assert.equal(idle.session, 'idle');
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
    assert.equal(api.controller.isActive, true);
    assert.equal(api.controller.isSuspended, false);
    assert.match(await call(owner, 'listen'), /queued while diagnostics runs/);
    await call(owner, 'end', { summary: 'Scratch verification complete.' });
    console.log('GUIDED_SMOKE_OK packaged prompts, idle and active diagnostics, isolated owner, saved edit and command');
  } finally {
    try {
      await observer?.close();
    } finally {
      try {
        await owner?.close();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  }
}
