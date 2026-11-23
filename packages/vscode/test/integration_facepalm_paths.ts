// Facepalm's subscription (#83, item 14 of facepalm#61), over a real Unix domain socket standing in
// for its daemon, through the real `FacepalmClient` extension.ts wires into the controller. The
// socket sits under `AI_PAIR_FACEPALM_HOME` (scripts/integration.sh), never the real per-user path,
// so this never touches a real Facepalm a developer running this suite might have installed.
// specs/FacepalmSubscription.tla models the lifecycle this exercises end to end.
import * as assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Api } from '../src/extension';

/** A real Unix domain socket, answering just enough of Facepalm's protocol (`src/protocol.h`,
 * facepalm#61) for one `beat`: `hello`, then `beat` with a fixed feeling. */
class FakeFacepalmDaemon {
  private readonly directory: string;
  private readonly token = randomBytes(32).toString('hex');
  private readonly server: net.Server;
  /** Every socket accepted: `FacepalmClient` keeps its own open for reuse, so `stop` destroys these
   * itself, rather than waiting for `server.close`'s callback, which an open connection would leave
   * forever unfired. */
  private readonly connections = new Set<net.Socket>();

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
          socket.write(`${this.answer(line)}\n`);
          newline = buffer.indexOf('\n');
        }
      });
    });
  }

  private answer(line: string): string {
    const words = line.split(' ');
    if (words[0] === 'hello') return words[2] === this.token ? '{"ok":true}' : '{"error":"a stranger"}';
    if (words[0] === 'beat') {
      return JSON.stringify({
        readings: [],
        missed: 0,
        // gaze (facepalm#142) rides along on every interpretation now; ai-pair#143 is this reaching the report.
        interpretation: { id: 1, feeling: 'confused', beat: words[1], feelings: ['confused', 'engagement'], gaze: 'away' },
      });
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

/** Plays a question's beat against a real Facepalm-shaped socket, through the real controller and
 * extension wiring, and checks it reaches the pair report with its feeling. */
export async function facepalmPaths(api: Api, root: string): Promise<void> {
  const directory = process.env.AI_PAIR_FACEPALM_HOME;
  assert.ok(directory !== undefined, 'AI_PAIR_FACEPALM_HOME is not set for this run');
  const { controller } = api;
  const daemon = new FakeFacepalmDaemon(directory);
  await daemon.listen();
  try {
    fs.writeFileSync(path.join(root, 'facepalm.txt'), 'a\n');
    await controller.start('facepalm');
    await controller.read('facepalm.txt');
    await controller.step([{ say: 'Shall I continue?' }]);
    const report = await controller.step([]);
    assert.equal(report.batches.at(-1)?.facepalm?.feeling, 'confused', `beat did not reach the report: ${JSON.stringify(report)}`);
    assert.equal(report.batches.at(-1)?.facepalm?.gaze, 'away', `gaze did not reach the report: ${JSON.stringify(report)}`);
    await controller.end();
  } finally {
    await daemon.stop();
  }
}
