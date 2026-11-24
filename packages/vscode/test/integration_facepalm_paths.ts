// Facepalm's subscription (#83, item 14 of facepalm#61), over a real Unix domain socket standing in
// for its daemon, through the real `FacepalmClient` extension.ts wires into the controller, and
// through the bundled relay so the agent's report is the real rendered text (packages/relay/src/
// render.ts), the same way `integration_render_diagnostic.ts` exercises it for a diagnostic. The
// socket sits under `AI_PAIR_FACEPALM_HOME` (scripts/integration.sh), never the real per-user path,
// so this never touches a real Facepalm a developer running this suite might have installed.
// specs/FacepalmSubscription.tla models the lifecycle this exercises end to end.
import * as assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Api } from '../src/extension';

/** A real Unix domain socket, answering just enough of Facepalm's protocol (`src/protocol.h`,
 * facepalm#61) for three `beat`s: `hello`, then `beat` with a fixed feeling, varying gaze (#143). */
class FakeFacepalmDaemon {
  private readonly directory: string;
  private readonly token = randomBytes(32).toString('hex');
  private readonly server: net.Server;
  /** Every socket accepted: `FacepalmClient` keeps its own open for reuse, so `stop` destroys these
   * itself, rather than waiting for `server.close`'s callback, which an open connection would leave
   * forever unfired. */
  private readonly connections = new Set<net.Socket>();
  /** How many `beat`s this daemon has answered, so each can differ (#143). */
  private beats = 0;
  readonly lines: string[] = [];

  get openConnections(): number {
    return this.connections.size;
  }

  constructor(directory: string) {
    this.directory = directory;
    fs.mkdirSync(path.join(directory, 'clients'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'clients', 'ai-pair'), this.token, { mode: 0o600 });
    this.server = net.createServer((socket) => {
      this.connections.add(socket);
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
          socket.write(`${this.answer(line)}\n`);
          newline = buffer.indexOf('\n');
        }
      });
    });
  }

  private answer(line: string): string {
    const words = line.split(' ');
    if (words[0] === 'hello') return words[2] === this.token ? '{"ok":true}' : '{"error":"a stranger"}';
    if (words[0] === 'feel') return '{"ok":true}';
    if (words[0] === 'beat') {
      this.beats += 1;
      // gaze (facepalm#142) rides along on every interpretation now; ai-pair#143 is this reaching
      // the agent's rendered report. The three beats carry, in turn: a gaze facepalmGazeNote words,
      // none at all (as an older Facepalm would send), and the other gaze it words - every outcome
      // that function can reach.
      const base = { id: this.beats, feeling: 'confused', beat: words[1], feelings: ['confused', 'engagement'] } as const;
      const interpretation = this.beats === 1 ? { ...base, gaze: 'away' } : this.beats === 3 ? { ...base, gaze: 'averted' } : base;
      return JSON.stringify({ readings: [], missed: 0, interpretation });
    }
    return '{"error":"unknown request"}';
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(path.join(this.directory, 'service.sock'), resolve);
    });
  }

  /** Destroys every connection, closes the socket, and removes its directory, so a later batch's
   * beat finds no token, fast. */
  stop(): Promise<void> {
    for (const socket of this.connections) socket.destroy();
    return new Promise((resolve) => {
      this.server.close(() => {
        fs.rmSync(this.directory, { recursive: true, force: true });
        resolve();
      });
    });
  }
}

/** Plays three question beats against a real Facepalm-shaped socket, through the real controller,
 * the real `FacepalmClient`, and the bundled relay, and checks the agent's actual rendered report
 * says the feeling and, when Facepalm sends it, where the programmer was looking (#143). */
export async function facepalmPaths(api: Api, root: string): Promise<void> {
  const directory = process.env.AI_PAIR_FACEPALM_HOME;
  assert.ok(directory !== undefined, 'AI_PAIR_FACEPALM_HOME is not set for this run');
  const daemon = new FakeFacepalmDaemon(directory);
  await daemon.listen();
  const client = new Client({ name: 'integration-facepalm', version: '1' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  let started = false;
  try {
    fs.writeFileSync(path.join(root, 'facepalm.txt'), 'a\n');
    // Refreshing the settings view only checks availability. It must not send hello,
    // which would join Facepalm and could activate its camera.
    api.panelMessage({ type: 'facepalmRefresh' });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
    assert.equal(daemon.lines.length, 0, 'refreshing settings joined Facepalm');
    assert.equal(daemon.openConnections, 0);
    await client.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env }));
    async function call(name: string, args: Record<string, unknown>): Promise<string> {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      assert.ok(Array.isArray(result.content));
      return result.content
        .map((part: unknown) => {
          assert.ok(typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string');
          return part.text;
        })
        .join('\n');
    }
    await call('start', { cwd: root, task: 'facepalm' });
    started = true;
    await call('read', { file: 'facepalm.txt' });
    await call('step', { actions: [{ say: 'Shall I continue?' }] });
    const first = await call('step', { actions: [] });
    assert.match(
      first,
      /Facepalm, from the programmer's camera, read a possible confused \(looking away\): advisory only, never an answer or approval\./,
      `gaze did not reach the agent's rendered report: ${first}`,
    );
    // The daemon's second beat omits gaze, as an older Facepalm would: the agent's report should
    // read exactly as it did before #143, with no parenthetical at all.
    await call('step', { actions: [{ say: 'Shall I continue again?' }] });
    const second = await call('step', { actions: [] });
    assert.match(
      second,
      /Facepalm, from the programmer's camera, read a possible confused: advisory only, never an answer or approval\./,
      `an older Facepalm's reply, with no gaze, should render with no parenthetical: ${second}`,
    );
    assert.doesNotMatch(second, /looking away|glancing away/);
    const cue = api.history().findLast((event) => event.type === 'facepalmCue');
    assert.ok(cue !== undefined && cue.type === 'facepalmCue', 'the panel did not receive the feedback card');
    api.panelMessage({ type: 'facepalmFeel', id: cue.id, feeling: 'engagement' });
    for (let attempt = 0; !daemon.lines.includes('feel 2 engagement') && attempt < 100; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.ok(daemon.lines.includes('feel 2 engagement'), 'the selected feeling did not reach Facepalm');
    // The daemon's third beat carries the other gaze facepalmGazeNote words: `averted`.
    await call('step', { actions: [{ say: 'Shall I continue once more?' }] });
    const third = await call('step', { actions: [] });
    assert.match(
      third,
      /Facepalm, from the programmer's camera, read a possible confused \(glancing away\): advisory only, never an answer or approval\./,
      `an averted gaze should render as glancing away: ${third}`,
    );
    assert.equal(daemon.openConnections, 1, 'the active session did not join Facepalm');
    api.panelMessage({ type: 'facepalmEnabled', value: false });
    for (let attempt = 0; daemon.openConnections > 0 && attempt < 100; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.equal(daemon.openConnections, 0, 'disabling Facepalm did not close its subscription');
    const linesBeforeDisabledBeat = daemon.lines.length;
    await call('step', { actions: [{ say: 'Continue without Facepalm?' }] });
    await call('step', { actions: [] });
    assert.equal(daemon.lines.length, linesBeforeDisabledBeat, 'a disabled session rejoined Facepalm');
    await call('end', {});
    started = false;
    console.log('Facepalm: every gaze outcome reaches the agent through the real relay (#143)');
  } finally {
    api.panelMessage({ type: 'facepalmEnabled', value: true });
    if (started) api.controller.endSession();
    await client.close();
    await daemon.stop();
  }
}
