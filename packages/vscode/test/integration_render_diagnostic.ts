// Exercises advisory diagnostic rendering through the bundled relay in VS Code.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Reports a real editor diagnostic to the agent through the real relay. */
export async function renderDiagnosticPaths(api: Api, root: string): Promise<void> {
  const file = path.join(root, 'render-diagnostic.txt');
  const collection = vscode.languages.createDiagnosticCollection('ai-pair-render-test');
  const client = new Client({ name: 'integration-render-diagnostic', version: '1' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  let started = false;
  try {
    await fs.writeFile(file, 'example\n');
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);
    const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 3), 'A real advisory error', vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'render-native';
    collection.set(document.uri, [diagnostic]);
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
    await call('start', { cwd: root, task: 'render real diagnostic' });
    started = true;
    await call('read', { file: 'render-diagnostic.txt' });
    const first = await call('step', {
      actions: [{ move: { file: 'render-diagnostic.txt', line: 1, to: 'line_end' } }, { type_fast: `x${CURSOR_MARKER}` }],
    });
    const finished = await call('step', { actions: [] });
    const report = `${first}\n${finished}`;
    assert.match(report, /Advisory diagnostic render-diagnostic\.txt:1 \(render-native\): A real advisory error/);
    assert.match(report, /Batch \d+ completed/);
    await call('end', {});
    started = false;
    console.log('RenderDiagnostic: real editor advisory is rendered by the bundled relay');
  } finally {
    if (started) api.controller.endSession();
    await client.close();
    collection.dispose();
    await fs.rm(file, { force: true });
  }
}
