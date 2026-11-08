// Checks the bundled relay's runtime guard through its generated launcher and the SDK.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DISCOVERY_SCHEMA, discoveryDir } from '@ai-pair/protocol';
import { WebSocketServer } from 'ws';
import type { Api } from '../src/extension';

/** Refuses mismatched runtime identities before a relay connects to a window. */
export async function runtimeIdentityPaths(api: Api, root: string): Promise<void> {
  const current: unknown = JSON.parse(fs.readFileSync(path.join(discoveryDir(), `${process.pid}.json`), 'utf8'));
  const discovery = DISCOVERY_SCHEMA.parse(current);
  assert.ok(discovery.runtime, 'active window has no runtime identity');
  const runtime = discovery.runtime;
  const folder = fs.mkdtempSync(path.join(root, 'identity-'));
  const file = path.join(discoveryDir(), 'runtime-identity-test.json');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  let connections = 0;
  server.on('connection', () => {
    connections++;
  });
  try {
    for (const candidate of [undefined, { ...runtime, version: `${runtime.version}-other` }, { ...runtime, relayHash: '0'.repeat(64) }]) {
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...discovery,
          workspaceFolders: [folder, path.join(folder, 'not-present')],
          port: address.port,
          runtime: candidate,
        }),
      );
      const client = new Client({ name: 'integration-runtime-identity', version: '1' });
      try {
        await client.connect(new StdioClientTransport({ command: api.launcher, cwd: folder, env }));
        const result = await client.callTool({ name: 'start', arguments: { cwd: folder } });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /runtime_mismatch.*Update and reload all AI Pair windows.*reconnect/);
        assert.equal(connections, 0, 'a mismatched window was contacted');
        assert.deepEqual(fs.readdirSync(folder), []);
      } finally {
        await client.close();
      }
    }
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(folder, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  console.log('RuntimeIdentity Safe: missing, different-version and different-digest windows refused before connection');
}
