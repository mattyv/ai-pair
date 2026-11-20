// Exercises both shipped worker commands and the MCP worker tools through the installed relay launcher.
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';
import { BATCH_RESULT_SCHEMA, DISCOVERY_SCHEMA, WORKER_ACK_SCHEMA, WORKER_GRANT_SCHEMA, WORKER_MODEL_LIMIT } from '@ai-pair/protocol';
import { z } from 'zod';
import type { Bridge } from '../../core/src/bridge';
import type { Api } from '../src/extension';

const TEXT_CONTENT = z.array(z.object({ type: z.literal('text'), text: z.string() }));
const STATUS = z.object({ active: z.boolean(), busy: z.boolean() });
const MODEL = 'integration-codex-model';
const WAIT_MS = 10_000;
const PROCESS_MS = 20_000;
const POLL_MS = 20;
const SCRIPT_MODE = 0o700;
const PARTIAL = '  Live worker prefix';
const FINAL = '  Live worker prefix\n\tfinal text  ';

/** Sends a tool call through MCP and returns its text, checking the caller-visible result. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}, failed = false): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const text = TEXT_CONTENT.parse(result.content)
    .map((part) => part.text)
    .join('\n');
  assert.equal(result.isError === true, failed, `${name} reported an unexpected success state`);
  return text;
}

/** Encodes private input and provider events as separate JSON lines. */
function ndjson(...records: unknown[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

/** Runs the real launcher using only fixture stdin and captures its public output. */
function launch(api: Api, cwd: string, env: NodeJS.ProcessEnv, argv: string[], input = '') {
  const child = spawn(api.launcher, argv, { cwd, env, stdio: 'pipe', timeout: PROCESS_MS });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (buffer: Buffer) => {
    stdout.push(buffer);
  });
  child.stderr.on('data', (buffer: Buffer) => {
    stderr.push(buffer);
  });
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
  child.stdin.end(input);
  return exited;
}

/** Installs a deterministic Codex app-server that waits between its first delta and the completed turn. */
function writeCodexFixture(dir: string): void {
  const fixture = `#!/bin/sh
[ "$#" -eq 3 ] && [ "$1" = 'app-server' ] && [ "$2" = '--listen' ] && [ "$3" = 'stdio://' ] || exit 40
IFS= read -r request || exit 41
case "$request" in *'"method":"initialize"'*) ;; *) exit 42 ;; esac
printf '%s\\n' '{"id":1,"result":{}}'
IFS= read -r request || exit 43
case "$request" in *'"method":"initialized"'*) ;; *) exit 44 ;; esac
IFS= read -r request || exit 45
case "$request" in *'"method":"thread/start"'*'"model":"${MODEL}"'*'"ephemeral":true'*'"approvalPolicy":"never"'*'"sandbox":"read-only"'*) ;; *) exit 46 ;; esac
printf '%s\\n' '{"id":2,"result":{"thread":{"id":"fixture-thread"}}}'
IFS= read -r request || exit 47
case "$request" in *'"method":"turn/start"'*'"threadId":"fixture-thread"'*) ;; *) exit 48 ;; esac
printf '%s\\n' '{"id":3,"result":{"turn":{"id":"fixture-turn"}}}'
printf '%s\\n' '{"method":"item/reasoning/textDelta","params":{"threadId":"fixture-thread","turnId":"fixture-turn","delta":"ignored reasoning"}}'
printf '%s\\n' '${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', itemId: 'item-0', delta: PARTIAL } })}'
while [ ! -f "$AI_PAIR_TEST_WORKER_RELEASE" ]; do sleep 0.05; done
printf '%s\\n' '${JSON.stringify({ method: 'item/completed', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { id: 'item-0', type: 'agentMessage', text: FINAL } } })}'
printf '%s\\n' '{"method":"turn/completed","params":{"threadId":"fixture-thread","turn":{"id":"fixture-turn","status":"completed"}}}'
IFS= read -r request || :
`;
  fs.writeFileSync(path.join(dir, 'codex'), fixture, { mode: SCRIPT_MODE });
}

/** Runs worker tools through the real relay and covers independent, exact-port worker requests. */
async function mcpWorkerPaths(owner: Client, worker: Client, filename: string): Promise<void> {
  assert.equal(await call(owner, 'worker_say', { text: 'No grant yet.' }, /* failed= */ true), 'Worker narration unavailable.');
  assert.deepEqual(STATUS.parse(JSON.parse(await call(owner, 'worker_status'))), { active: false, busy: false });
  assert.equal(await call(worker, 'worker_status', {}, /* failed= */ true), 'Worker status unavailable.');
  const grant = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant', { brief: 'MCP worker tools' })));
  assert.equal(grant.model, MODEL);
  assert.equal(await call(owner, 'worker_grant', {}, /* failed= */ true), 'Worker grant unavailable.');
  assert.equal(WORKER_ACK_SCHEMA.parse(JSON.parse(await call(owner, 'worker_say', { text: 'Checking the worker output.' }))).ok, true);
  assert.match(await call(worker, 'worker_read', { ...grant, file: filename }), /worker fixture/);
  const step = await call(worker, 'worker_step', { ...grant, actions: [{ move: { file: filename, line: 1, to: 'line_end' } }] });
  assert.equal(BATCH_RESULT_SCHEMA.parse(JSON.parse(step)).status, 'completed');
  assert.equal(await call(worker, 'worker_progress', { ...grant, text: 'Checked the fixture.' }), '{"ok":true}');
  assert.match(
    await call(worker, 'worker_output', { ...grant, text: 'invalid', final: true }, /* failed= */ true),
    /requires a message ID/,
  );
  assert.equal(await call(worker, 'worker_output', { ...grant, text: 'checked output', message: 'mcp-item', final: true }), '{"ok":true}');
  const unavailable = grant.port === 1 ? 2 : 1;
  assert.equal(
    await call(worker, 'worker_output', { ...grant, port: unavailable, text: 'wrong window' }, /* failed= */ true),
    'no_editor: Worker call failed.',
  );
  assert.equal(await call(worker, 'worker_notice', { ...grant, notice: 'question', text: 'Is the fixture visible?' }), '{"ok":true}');
  assert.match(await call(owner, 'listen'), /Is the fixture visible/);
  assert.equal(await call(worker, 'worker_done', { ...grant, text: 'MCP worker complete.' }), '{"ok":true}');
  assert.match(await call(owner, 'listen'), /MCP worker complete/);
  assert.equal(
    await call(worker, 'worker_progress', { ...grant, text: 'late' }, /* failed= */ true),
    'invalid_arguments: Worker call failed.',
  );
}

/** Checks the installed Bridge's defensive contract with an injected model outside the settings boundary. */
async function invalidModelPaths(api: Api, root: string, env: Record<string, string>, home: string): Promise<void> {
  const { runtime } = DISCOVERY_SCHEMA.parse(JSON.parse(fs.readFileSync(api.bridge.file, 'utf8')));
  assert.ok(runtime, 'the installed bridge did not advertise its runtime');
  // Instantiate the bundled class so coverage measures the actual extension implementation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const InstalledBridge = api.bridge.constructor as typeof Bridge;
  let model = ' ';
  const bridge = new InstalledBridge(api.controller, {
    dir: path.join(home, 'windows'),
    runtime,
    workspaceFolders: () => [root],
    calibrate: () => false,
    workerModel: (provider) => {
      assert.equal(provider, 'codex');
      return model;
    },
  });
  const owner = new Client({ name: 'codex-mcp-client', version: 'test' });
  let disposed = false;
  try {
    await bridge.start();
    await owner.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env: { ...env, AI_PAIR_HOME: home } }));
    await call(owner, 'start', { cwd: root });
    for (const invalid of [' ', 'x'.repeat(WORKER_MODEL_LIMIT + 1)]) {
      model = invalid;
      assert.equal(await call(owner, 'worker_grant', {}, /* failed= */ true), 'Worker grant unavailable.');
      assert.deepEqual(STATUS.parse(JSON.parse(await call(owner, 'worker_status'))), { active: false, busy: false });
    }
    model = MODEL;
    const grant = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant')));
    assert.equal(grant.model, MODEL);
    await call(owner, 'end');
    const [connection] = bridge.connections();
    assert.ok(connection, 'the test relay is still attached');
    const retired = once(connection, 'close', { signal: AbortSignal.timeout(WAIT_MS) });
    bridge.dispose();
    disposed = true;
    await retired;
    assert.equal(bridge.connections().size, 0);
    assert.equal(fs.existsSync(bridge.file), false);
    assert.equal(await call(owner, 'worker_status', {}, /* failed= */ true), 'Worker status unavailable.');
  } finally {
    await owner.close();
    if (!disposed) bridge.dispose();
    api.controller.endSession();
  }
}

/** Exercises live updates and successful, failed, and invalid launcher invocations through the installed relay. */
export async function workerCliPaths(api: Api, root: string, env: Record<string, string>): Promise<void> {
  const setting = vscode.workspace.getConfiguration('aiPair');
  const oldEnabled = setting.inspect<boolean>('worker.enabled')?.globalValue;
  const oldModel = setting.inspect<string>('worker.codexModel')?.globalValue;
  const oldSpeech = setting.inspect<boolean>('speech.enabled')?.globalValue;
  const owner = new Client({ name: 'codex-mcp-client', version: 'test' });
  const worker = new Client({ name: 'worker-fixture', version: 'test' });
  const fixture = fs.mkdtempSync(path.join(root, 'worker-cli-'));
  const filename = path.relative(root, path.join(fixture, 'input.txt'));
  const release = path.join(fixture, 'release');
  const childEnv = { ...env, PATH: `${fixture}${path.delimiter}${env.PATH ?? ''}`, AI_PAIR_TEST_WORKER_RELEASE: release };
  try {
    fs.writeFileSync(path.join(root, filename), 'worker fixture\n');
    writeCodexFixture(fixture);
    await setting.update('worker.enabled', true, vscode.ConfigurationTarget.Global);
    await setting.update('worker.codexModel', MODEL, vscode.ConfigurationTarget.Global);
    await setting.update('speech.enabled', false, vscode.ConfigurationTarget.Global);
    await owner.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env }));
    await worker.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env }));
    await call(owner, 'start', { cwd: root });
    await mcpWorkerPaths(owner, worker, filename);

    const live = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant')));
    const activity = api.history().findLast((event) => event.type === 'workerActivity' && event.phase === 'started');
    assert.ok(activity?.type === 'workerActivity');
    const runner = launch(api, root, childEnv, ['worker-run', 'codex'], ndjson(live, { model: MODEL, prompt: 'Private fixture prompt.' }));
    try {
      const deadline = Date.now() + WAIT_MS;
      let partial = false;
      while (!partial && Date.now() < deadline) {
        partial = api.history().some((event) => event.type === 'workerOutput' && event.id === activity.id && event.text === PARTIAL);
        if (!partial) await delay(POLL_MS);
      }
      assert.ok(partial, 'the first Codex delta must be visible before the provider can finish');
      assert.ok(!api.history().some((event) => event.type === 'workerActivity' && event.id === activity.id && event.phase === 'completed'));
    } finally {
      fs.writeFileSync(release, 'complete');
      assert.deepEqual(await runner, { code: 0, stdout: '', stderr: '' });
    }
    const output = api.history().filter((event) => event.type === 'workerOutput' && event.id === activity.id);
    assert.deepEqual(output, [{ type: 'workerOutput', id: activity.id, message: 'item-0', text: FINAL }]);
    assert.match(await call(owner, 'listen'), /Codex worker finished/);

    const failed = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant')));
    const invalid = ndjson(failed, { model: 'mismatched-model', prompt: 'private fixture' });
    assert.deepEqual(await launch(api, root, childEnv, ['worker-run', 'codex'], invalid), {
      code: 1,
      stdout: '',
      stderr: 'Codex worker failed.\n',
    });
    assert.match(await call(owner, 'listen'), /Codex worker failed/);
    assert.deepEqual(await launch(api, root, childEnv, ['worker-run', 'invalid']), {
      code: 1,
      stdout: '',
      stderr: 'Usage: pair-mcp worker-run codex\n',
    });

    const transcript = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant')));
    const records = ndjson(
      transcript,
      { type: 'item.completed', item: { type: 'reasoning', text: 'private transcript reasoning' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Completed transcript output.' } },
      { type: 'turn.completed' },
    );
    assert.deepEqual(await launch(api, root, childEnv, ['worker-transcript', 'codex'], records), { code: 0, stdout: '', stderr: '' });
    assert.ok(api.history().some((event) => event.type === 'workerOutput' && event.text === 'Completed transcript output.'));
    assert.match(await call(owner, 'listen'), /Codex worker finished/);
    const incomplete = WORKER_GRANT_SCHEMA.parse(JSON.parse(await call(owner, 'worker_grant')));
    assert.deepEqual(await launch(api, root, childEnv, ['worker-transcript', 'codex'], ndjson(incomplete)), {
      code: 1,
      stdout: '',
      stderr: 'Codex worker transcript failed.\n',
    });
    assert.match(await call(owner, 'listen'), /Codex worker transcript failed/);
    assert.deepEqual(await launch(api, root, childEnv, ['worker-transcript', 'invalid']), {
      code: 1,
      stdout: '',
      stderr: 'Usage: pair-mcp worker-transcript codex\n',
    });
    await call(owner, 'end');
    await invalidModelPaths(api, root, env, path.join(fixture, 'invalid-model-home'));
    console.log('Worker launcher: real MCP routing, pre-completion Codex output, and both CLI outcomes');
  } finally {
    api.controller.endSession();
    await owner.close();
    await worker.close();
    await setting.update('speech.enabled', oldSpeech, vscode.ConfigurationTarget.Global);
    await setting.update('worker.codexModel', oldModel, vscode.ConfigurationTarget.Global);
    await setting.update('worker.enabled', oldEnabled, vscode.ConfigurationTarget.Global);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
