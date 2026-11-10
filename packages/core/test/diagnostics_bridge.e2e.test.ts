import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DISCOVERY_SCHEMA, EDITOR_MESSAGE_SCHEMA, PROTOCOL_VERSION } from '@ai-pair/protocol';
import { Bridge } from '../src/bridge';
import { setup } from './fake';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-diagnostics-'));
let bridge: Bridge | undefined;
const sockets: WebSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
  bridge?.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

function receive(socket: WebSocket): Promise<ReturnType<typeof EDITOR_MESSAGE_SCHEMA.parse>> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      if (!Buffer.isBuffer(data)) throw new Error('Expected a buffer');
      resolve(EDITOR_MESSAGE_SCHEMA.parse(JSON.parse(data.toString('utf8'))));
    });
  });
}
async function call(socket: WebSocket, id: number, tool: string): Promise<ReturnType<typeof EDITOR_MESSAGE_SCHEMA.parse>> {
  const response = receive(socket);
  socket.send(JSON.stringify({ type: 'call', id, tool, args: {} }));
  return response;
}
it('DiagnosticsRequest Isolation: a second agent diagnoses and closes without draining the owner report', async () => {
  const { controller } = setup();
  bridge = new Bridge(controller, {
    dir,
    workspaceFolders: () => ['/project'],
    runtime: { version: 'test', build: 'test', relayHash: 'test' },
    calibrate: () => true,
    collectDiagnostics: () =>
      Promise.resolve({
        version: 'test',
        build: 'test',
        session: 'active',
        connection: 'connected',
        connectionId: 1,
        paused: false,
        pauseReasons: [],
        events: [],
      }),
  });
  await bridge.start();
  const discovery = DISCOVERY_SCHEMA.parse(JSON.parse(fs.readFileSync(bridge.file, 'utf8')));
  async function connect(): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${discovery.port}`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const welcome = receive(socket);
    socket.send(JSON.stringify({ type: 'hello', token: discovery.token, protocolVersion: PROTOCOL_VERSION }));
    expect(await welcome).toEqual({ type: 'welcome' });
    return socket;
  }
  const owner = await connect();
  expect(await call(owner, 1, 'start')).toMatchObject({ type: 'result' });
  controller.userMessage('A queued report');
  const observer = await connect();
  expect(await call(observer, 2, 'diagnostics')).toMatchObject({ type: 'result', result: { session: 'active' } });
  observer.close();
  await new Promise<void>((resolve) => {
    observer.once('close', () => {
      resolve();
    });
  });
  expect(controller.isActive).toBe(true);
  expect(controller.isSuspended).toBe(false);
  expect(await call(owner, 3, 'listen')).toMatchObject({
    type: 'result',
    result: { events: [{ kind: 'message', text: 'A queued report' }] },
  });
});
