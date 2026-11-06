// Focused native VS Code smoke test: literal agent edits and session reconnect.
// Set AI_PAIR_SMOKE_CODE_PACE=normal to run the three playback modes at 1x;
// otherwise those trials use 20x for a faster compatibility check.
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

const BODY_REPEATS = 3;
const LANGUAGE_STARTUP_MS = 2000;
const DIAGNOSTIC_WAIT_MS = 15_000;
const DIAGNOSTIC_POLL_MS = 100;

/** Returns whether an extension export has the API this smoke test uses. */
function isApi(value: unknown): value is Api {
  return typeof value === 'object' && value !== null && 'controller' in value && 'ready' in value;
}

/** Checks literal triple quotes and reconnect in the isolated VS Code workspace. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('michalstrba.ai-pair');
  assert.ok(extension, 'AI Pair extension not found');
  const exported: unknown = await extension.activate();
  assert.ok(isApi(exported), 'AI Pair did not export its API');
  const api = exported;
  await api.ready;
  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, 'No isolated workspace');
  const editorSettings = vscode.workspace.getConfiguration('editor');
  const pythonSettings = vscode.workspace.getConfiguration('python');
  const analysisSettings = vscode.workspace.getConfiguration('python.analysis');
  const interpreterSetting = pythonSettings.inspect<unknown>('defaultInterpreterPath');
  const typeCheckingSetting = analysisSettings.inspect<unknown>('typeCheckingMode');
  const pythonAvailable = vscode.extensions.getExtension('ms-python.python') !== undefined;
  const pylanceAvailable = vscode.extensions.getExtension('ms-python.vscode-pylance') !== undefined;
  let interpreterChanged = false;
  let typeCheckingChanged = false;
  const originalQuotes = editorSettings.inspect<unknown>('autoClosingQuotes')?.workspaceValue;
  const originalBrackets = editorSettings.inspect<unknown>('autoClosingBrackets')?.workspaceValue;
  const originalIndent = editorSettings.inspect<unknown>('autoIndent')?.workspaceValue;
  const file = `native-smoke-${randomUUID()}.py`;
  const uri = vscode.Uri.joinPath(workspace.uri, file);
  const syntheticFiles = new Set<string>();
  const createdFiles: vscode.Uri[] = [];
  const changes: unknown[] = [];
  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!syntheticFiles.has(event.document.uri.toString())) return;
    changes.push({
      file: event.document.uri.toString(),
      time: Date.now(),
      version: event.document.version,
      reason: event.reason ?? 'unspecified',
      changes: event.contentChanges.map((change) => ({
        offset: change.rangeOffset,
        length: change.rangeLength,
        text: change.text,
      })),
      snapshot: event.document.getText(),
    });
  });
  const closeMode = process.env.AI_PAIR_SMOKE_AUTO_CLOSE === 'never' ? 'never' : 'always';
  let created = false;
  try {
    await editorSettings.update('autoClosingQuotes', closeMode, vscode.ConfigurationTarget.Workspace);
    await editorSettings.update('autoClosingBrackets', closeMode, vscode.ConfigurationTarget.Workspace);
    await editorSettings.update('autoIndent', 'full', vscode.ConfigurationTarget.Workspace);
    if (pythonAvailable && interpreterSetting) {
      await pythonSettings.update('defaultInterpreterPath', '/usr/bin/python3', vscode.ConfigurationTarget.Workspace);
      interpreterChanged = true;
    }
    if (pylanceAvailable && typeCheckingSetting) {
      await analysisSettings.update('typeCheckingMode', 'basic', vscode.ConfigurationTarget.Workspace);
      typeCheckingChanged = true;
    }
    for (const id of ['ms-python.python', 'ms-python.vscode-pylance']) {
      const pythonExtension = vscode.extensions.getExtension(id);
      if (pythonExtension) {
        const metadata: unknown = pythonExtension.packageJSON;
        const version = typeof metadata === 'object' && metadata !== null && 'version' in metadata ? metadata.version : 'unknown';
        console.log(`Native extension ${id}: ${String(version)}`);
        await pythonExtension.activate();
      }
    }
    syntheticFiles.add(uri.toString());
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
    created = true;
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const controller = api.controller;
    controller.setSpeed(20);
    await controller.start('Native triple-quote smoke', workspace.uri.fsPath);
    const failures: string[] = [];
    try {
      const first = await controller.step([{ move: { file, line: 1, to: 'line_end' } }, { type: `"""${CURSOR_MARKER}"""` }]);
      const completed = await controller.step([]);
      const reports = [first, completed];
      assert.deepEqual(
        reports.flatMap((report) => report.batches.map((batch) => batch.status)),
        ['completed'],
      );
      assert.equal(document.getText(), '""""""', 'The editor changed the literal quote count');
      assert.equal(controller.saved?.scene.cursor?.offset, 3, 'The agent cursor is not between the triples');
      assert.equal(
        reports.flatMap((report) => report.events).some((event) => event.kind === 'edit' && event.by === 'programmer'),
        false,
        'An agent edit was reported as a programmer edit',
      );
    } catch (error) {
      failures.push(`Module trial: ${String(error)}`);
    } finally {
      controller.endSession();
    }

    try {
      await controller.start('Native reconnect smoke', workspace.uri.fsPath);
      controller.disconnect();
      assert.equal(controller.isSuspended, true);
      const resumed = await controller.start('New task should not replace the old task', workspace.uri.fsPath);
      assert.equal(resumed.resumed, true, 'The same-root session did not resume');
      assert.equal(controller.saved?.task, 'Native reconnect smoke');
      console.log('Native reconnect trial passed');
    } catch (error) {
      failures.push(`Reconnect trial: ${String(error)}`);
    } finally {
      controller.endSession();
    }

    controller.setSpeed(1);
    console.log('Native function-body trials: playback speed 1');
    for (let index = 0; index < BODY_REPEATS; index++) {
      const bodyFile = `native-body-${randomUUID()}.py`;
      const bodyUri = vscode.Uri.joinPath(workspace.uri, bodyFile);
      const prefix = 'async def get_other_movements() -> OtherMovementsResponse:\n    ';
      syntheticFiles.add(bodyUri.toString());
      await vscode.workspace.fs.writeFile(bodyUri, Buffer.from(prefix));
      createdFiles.push(bodyUri);
      const body = await vscode.workspace.openTextDocument(bodyUri);
      await vscode.window.showTextDocument(body);
      // Give an installed language service a bounded opportunity to initialize.
      if (index === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, LANGUAGE_STARTUP_MS);
        });
      }
      if (pylanceAvailable) {
        const deadline = Date.now() + DIAGNOSTIC_WAIT_MS;
        let diagnostics = vscode.languages.getDiagnostics(bodyUri);
        while (!diagnostics.some((item) => item.source?.toLowerCase() === 'pylance') && Date.now() < deadline) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, DIAGNOSTIC_POLL_MS);
          });
          diagnostics = vscode.languages.getDiagnostics(bodyUri);
        }
        console.log(
          `Native Pylance diagnostics ${index + 1}: ${JSON.stringify(diagnostics.map((item) => ({ source: item.source, message: item.message })))}`,
        );
        assert.ok(
          diagnostics.some((item) => item.source?.toLowerCase() === 'pylance'),
          'Pylance readiness timed out for synthetic file',
        );
      }
      await controller.start(`Native body trial ${index + 1}`, workspace.uri.fsPath);
      try {
        await controller.read(bodyFile);
        const submitted = await controller.step([
          { move: { file: bodyFile, line: 2, to: 'line_end' } },
          { type: `"""${CURSOR_MARKER}"""` },
        ]);
        const finished = await controller.step([]);
        const bodyReports = [submitted, finished];
        console.log(`Native body report ${index + 1}: ${JSON.stringify(bodyReports)}`);
        assert.deepEqual(
          bodyReports.flatMap((report) => report.batches.map((batch) => batch.status)),
          ['completed'],
        );
        assert.equal(body.getText(), `${prefix}""""""`, 'Unexpected document text while typing the function docstring');
        assert.equal(controller.saved?.scene.cursor?.offset, prefix.length + 3);
        assert.equal(
          bodyReports.flatMap((report) => report.events).some((event) => event.kind === 'edit' && event.by === 'programmer'),
          false,
        );
      } catch (error) {
        failures.push(`Body trial ${index + 1}: ${String(error)}`);
      } finally {
        controller.endSession();
      }
    }

    const modeSpeed = process.env.AI_PAIR_SMOKE_CODE_PACE === 'normal' ? 1 : 20;
    controller.setSpeed(modeSpeed);
    for (const mode of ['typing', 'lines', 'blocks'] as const) {
      const startedAt = Date.now();
      const modeFile = `native-mode-${mode}-${randomUUID()}.py`;
      const modeUri = vscode.Uri.joinPath(workspace.uri, modeFile);
      const prefix = 'def sample():\n    ';
      const before = '"""first\n    second';
      const after = '\n    """';
      syntheticFiles.add(modeUri.toString());
      await vscode.workspace.fs.writeFile(modeUri, Buffer.from(prefix));
      createdFiles.push(modeUri);
      const modeDocument = await vscode.workspace.openTextDocument(modeUri);
      await vscode.window.showTextDocument(modeDocument);
      controller.setCodePlayback(mode);
      await controller.start(`Native ${mode} playback`, workspace.uri.fsPath);
      try {
        await controller.read(modeFile);
        const submitted = await controller.step([
          { move: { file: modeFile, line: 2, to: 'line_end' } },
          { type: `${before}${CURSOR_MARKER}${after}` },
        ]);
        const finished = await controller.step([]);
        assert.deepEqual(
          [submitted, finished].flatMap((report) => report.batches.map((batch) => batch.status)),
          ['completed'],
        );
        assert.equal(modeDocument.getText(), prefix + before + after);
        assert.equal(controller.saved?.scene.cursor?.offset, prefix.length + before.length);
        assert.equal(
          [submitted, finished].flatMap((report) => report.events).some((event) => event.kind === 'edit' && event.by === 'programmer'),
          false,
        );
        console.log(`Native ${mode} grouped playback passed at ${modeSpeed}x in ${Date.now() - startedAt} ms`);
      } catch (error) {
        failures.push(`${mode} playback: ${String(error)}`);
      } finally {
        controller.endSession();
      }
    }
    controller.setCodePlayback('typing');

    assert.deepEqual(failures, [], 'One or more native trials failed; see synthetic event trace');
    console.log('Native smoke passed: triple quotes, cursor, event authorship, and same-root reconnect');
  } finally {
    console.log(`Native synthetic document events (${closeMode}): ${JSON.stringify(changes)}`);
    listener.dispose();
    api.controller.endSession();
    await editorSettings.update('autoClosingQuotes', originalQuotes, vscode.ConfigurationTarget.Workspace);
    await editorSettings.update('autoClosingBrackets', originalBrackets, vscode.ConfigurationTarget.Workspace);
    await editorSettings.update('autoIndent', originalIndent, vscode.ConfigurationTarget.Workspace);
    if (interpreterChanged) {
      await pythonSettings.update('defaultInterpreterPath', interpreterSetting?.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
    if (typeCheckingChanged) {
      await analysisSettings.update('typeCheckingMode', typeCheckingSetting?.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
    if (created) await vscode.workspace.fs.delete(uri, { useTrash: false });
    for (const createdFile of createdFiles) {
      await vscode.workspace.fs.delete(createdFile, { useTrash: false });
    }
  }
}
