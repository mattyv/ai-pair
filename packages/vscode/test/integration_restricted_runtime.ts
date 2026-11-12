// Exercises the real local support gate when both current-process evidence sources are inaccessible.
import * as assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

const snapshot = z.object({ events: z.array(z.looseObject({ kind: z.string() })) });

/** Uses real extension behavior with a narrowly denied diagnostic report and process-maps read. */
export async function run(): Promise<void> {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const extension = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(extension && !extension.isActive, 'main must be inactive before installing the evidence fault');
  const reportDescriptor = Object.getOwnPropertyDescriptor(process.report, 'getReport');
  const openDescriptor = Object.getOwnPropertyDescriptor(fs, 'openSync');
  assert.ok(reportDescriptor && openDescriptor, 'the evidence APIs must expose restorable descriptors');
  const originalOpen = fs.openSync;
  let reports = 0;
  let maps = 0;
  let api: Api | undefined;
  let file: string | undefined;
  try {
    Object.defineProperty(process.report, 'getReport', {
      ...reportDescriptor,
      value: () => {
        reports++;
        throw new Error('synthetic report restriction');
      },
    });
    Object.defineProperty(fs, 'openSync', {
      ...openDescriptor,
      value: (filename: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
        if (filename === '/proc/self/maps') {
          maps++;
          throw Object.assign(new Error('synthetic maps restriction'), { code: 'EACCES' });
        }
        return originalOpen(filename, flags, mode);
      },
    });
    api = await extension.activate();
    await api.ready;
    assert.ok(reports > 0 && maps > 0, 'the running extension did not reach both restricted evidence sources');
    await api.previewSpeech();
    assert.equal(api.speechStatus()?.state, 'unavailable');
    assert.equal(api.speechStatus()?.started, false);

    let blocked = false;
    for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
      await vscode.env.clipboard.writeText('');
      api.panelMessage({ type: 'copyDiagnostics' });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
      const copied = await vscode.env.clipboard.readText();
      if (copied !== '') {
        const parsed = snapshot.parse(JSON.parse(copied));
        blocked = parsed.events.some(
          (event) =>
            event.kind === 'speech' &&
            event.event === 'capability' &&
            event.provider === 'kokoro' &&
            event.phase === 'blocked' &&
            event.reason === 'unsupported',
        );
      }
    }
    assert.ok(blocked, 'the capability report did not identify unsupported local speech');

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the restricted runtime test needs an isolated workspace');
    file = path.join(folder.uri.fsPath, 'restricted-runtime-reading.txt');
    fs.writeFileSync(file, 'A readable line.\n');
    await api.controller.start('restricted speech evidence');
    const result = await api.controller.read('restricted-runtime-reading.txt', 1, 1);
    assert.equal(result.lines[0]?.text, 'A readable line.');
    await api.controller.end();
    console.log('restricted runtime evidence blocks Kokoro while normal reading remains available');
  } finally {
    api?.controller.endSession();
    Object.defineProperty(process.report, 'getReport', reportDescriptor);
    Object.defineProperty(fs, 'openSync', openDescriptor);
    if (file !== undefined) fs.rmSync(file, { force: true });
  }
}
