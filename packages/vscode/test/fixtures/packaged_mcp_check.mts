// Exercises the installed extension's generated launcher against an isolated VS Code workspace.
// Usage: node packages/vscode/test/fixtures/packaged_mcp_check.mts LAUNCHER WORKSPACE OUTSIDE EXPECTED_VERSION
// Start VS Code with the packaged extension and a fresh AI_PAIR_HOME before running this script.
// In that isolated profile, set aiPair.confirmCommands to false so pwd can run unattended.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ATTEMPTS = 20;
const POLL_MS = 100;
const DISCONNECT_MS = 300;
const CURSOR_CODE_POINT = 0x258c;
const [launcher, workspace, outside, expectedVersion] = process.argv.slice(2);
assert.ok(
  launcher !== undefined && workspace !== undefined && outside !== undefined && expectedVersion !== undefined,
  'Provide launcher, workspace, outside directory and expected version',
);
assert.ok(path.isAbsolute(launcher) && path.isAbsolute(workspace) && path.isAbsolute(outside));
assert.notEqual(workspace, outside);
assert.deepEqual(fs.readdirSync(workspace), [], 'Workspace must be a fresh isolated directory');
assert.deepEqual(fs.readdirSync(outside), [], 'Outside directory must be a fresh isolated directory');
assert.ok(process.env.AI_PAIR_HOME !== undefined, 'Set AI_PAIR_HOME to the isolated VS Code instance home');

const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
let client: Client;
async function connect(): Promise<Client> {
  assert.ok(launcher !== undefined && workspace !== undefined);
  const next = new Client({ name: 'packaged-mcp-check', version: '1' });
  await next.connect(new StdioClientTransport({ command: launcher, cwd: workspace, env }));
  assert.equal(next.getServerVersion()?.version, expectedVersion);
  return next;
}
async function call(name: string, args: Record<string, unknown>): Promise<{ error: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(Array.isArray(result.content));
  const text = result.content
    .map((part: unknown) => {
      assert.ok(typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string');
      return part.text;
    })
    .join('\n');
  return { error: result.isError === true, text };
}
async function accepted(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await call(name, args);
  assert.equal(result.error, false, result.text);
  return result.text;
}
async function batch(actions: unknown[]): Promise<string> {
  await accepted('step', { actions });
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const result = await accepted('step', { actions: [] });
    if (/Batch \d+ (completed|failed|interrupted)/.test(result)) return result;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
  throw new Error('Batch did not finish');
}

client = await connect();
try {
  const refused = await call('start', { cwd: outside });
  assert.ok(refused.error, refused.text);
  assert.match(refused.text, /no_editor|invalid_cwd/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(fs.readdirSync(workspace), []);
  await accepted('start', { cwd: workspace });
  // Cursor marker is the protocol's U+258C; the fixture deliberately has no source imports.
  const cursor = String.fromCodePoint(CURSOR_CODE_POINT);
  assert.match(
    await batch([{ move: { file: 'packaged-check.txt', line: 1, to: 'line_end' } }, { type_fast: `fixture${cursor}` }]),
    /Batch 1 completed/,
  );
  assert.match(await accepted('read', { file: 'packaged-check.txt' }), /fixture/);
  const run = await batch([{ run: 'pwd' }]);
  assert.match(run, /completed/);
  assert.ok(run.includes(workspace), run);
  assert.deepEqual(fs.readdirSync(outside), []);
  await accepted('end');
  await accepted('start', { cwd: workspace });
  assert.match(await batch([{ say: 'First batch in the new session.' }]), /Batch 1 completed/);
  await client.close();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, DISCONNECT_MS);
  });
  client = await connect();
  assert.match(await accepted('start', { cwd: workspace }), /session has resumed/i);
  assert.match(await batch([{ say: 'Second batch after reconnecting.' }]), /Batch 2 completed/);
  await accepted('end');
  console.log('Packaged MCP check passed: identity, cwd, edit, command, fresh session, and resume.');
} finally {
  await client.close();
}
