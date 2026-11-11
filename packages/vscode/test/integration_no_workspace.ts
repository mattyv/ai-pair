// Real empty-window path: the demo must not create files without a workspace.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

export async function run(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders, undefined, 'the test requires an empty window');
  const extension = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(extension, 'main extension not found');
  const api = await extension.activate();
  await api.ready;
  assert.equal(api.controller.isActive, false);
  const descriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
  assert.ok(descriptor, 'VS Code did not expose showErrorMessage');
  const show = vscode.window.showErrorMessage.bind(vscode.window);
  const errors: string[] = [];
  try {
    Object.defineProperty(vscode.window, 'showErrorMessage', {
      ...descriptor,
      value: (...args: unknown[]) => {
        if (typeof args[0] === 'string') errors.push(args[0]);
        const result: unknown = Reflect.apply(show, undefined, args);
        return result;
      },
    });
    await vscode.commands.executeCommand('aiPair.playDemo');
    assert.ok(errors.includes('Open a folder first: the demo creates files in ai-pair-demo/.'));
    assert.equal(api.controller.isActive, false, 'the demo started a session in an empty window');
  } finally {
    Object.defineProperty(vscode.window, 'showErrorMessage', descriptor);
  }
  console.log('an empty window refuses the demo without starting a session');
}
