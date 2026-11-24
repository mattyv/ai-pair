import { Window } from 'happy-dom';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { FacepalmClient } from '../src/facepalm_client';
import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Controller } from '@ai-pair/core';
import type * as vscode from 'vscode';
import { NarrationPanel, type PanelWiring } from '../src/panel';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn().mockResolvedValue(undefined) } }));

it('HistoryNeverSends: restored history cannot target a fresh owner reusing its card ID', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facepalm-replay-'));
  fs.mkdirSync(path.join(directory, 'clients'));
  fs.writeFileSync(path.join(directory, 'clients', 'ai-pair'), 'a'.repeat(64), { mode: 0o600 });
  vi.stubEnv('AI_PAIR_FACEPALM_HOME', directory);
  const received: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        received.push(line);
        if (line.startsWith('hello ')) socket.write('{"ok":true}\n');
        else if (line.startsWith('beat ')) {
          socket.write(
            `${JSON.stringify({ readings: [], missed: 0, interpretation: { id: 7, feeling: 'agreement', beat: 'question', feelings: ['agreement'] } })}\n`,
          );
        } else if (line.startsWith('feel ')) socket.write('{"ok":true}\n');
        end = buffer.indexOf('\n');
      }
    });
  });
  const client = new FacepalmClient();
  const window = new Window();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path.join(directory, 'service.sock'), resolve);
    });
    for (const key of [
      'window',
      'document',
      'HTMLElement',
      'HTMLButtonElement',
      'HTMLInputElement',
      'HTMLSelectElement',
      'HTMLTextAreaElement',
      'HTMLDetailsElement',
      'HTMLAnchorElement',
      'HTMLAudioElement',
      'HTMLDialogElement',
      'HTMLLabelElement',
      'Element',
      'Node',
      'Event',
      'MouseEvent',
    ]) {
      if (key === 'window') vi.stubGlobal(key, window);
      else if (key === 'document') vi.stubGlobal(key, window.document);
      else vi.stubGlobal(key, Reflect.get(window, key));
    }
    vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
    vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
      },
    );
    const controller = mock<Controller>({ commandApprovals: { all: false, commands: [], confirmationRequired: true } });
    const wiring = mock<PanelWiring>({
      workerEnabled: { get: () => false, set: () => {} },
      workerModel: { get: () => '', set: () => {} },
      workerVisibility: { get: () => 'milestones', set: () => {} },
      controller: () => controller,
      starter: { available: () => Promise.resolve(false), start: () => Promise.resolve() },
      facepalm: {
        snapshot: () => ({ enabled: true, status: 'idle', available: true, canOpenSettings: false }),
        enabled: () => {},
        refresh: () => {},
        openSettings: () => {},
      },
    });
    const numberSetting = { get: () => 1, set: () => {} };
    const flag = { get: () => false, set: () => {} };
    const panel = new NarrationPanel(
      () => '',
      numberSetting,
      numberSetting,
      { current: () => undefined, ref: () => undefined },
      () => {},
      mock<vscode.Uri>(),
      wiring,
      { get: () => 'newestFirst', set: () => {} },
      { version: 'test', build: 'test' },
      flag,
      () => false,
      { get: () => 'typing', set: () => {} },
      { get: () => 'interrupt', set: () => {} },
      flag,
      { get: () => 'helpful', set: () => {} },
    );
    const cue = { type: 'facepalmCue' as const, id: 1, feeling: 'agreement' as const, feelings: ['agreement' as const] };
    panel.restoreHistory([cue]);
    const posted = vi.fn((message: { type: string; id?: number; feeling?: 'agreement' }) => {
      if (message.type === 'facepalmFeel' && message.id !== undefined && message.feeling !== undefined) {
        void client.feel(message.id, message.feeling);
      }
    });
    const { loadPage } = await import('./page');
    await loadPage(posted);
    panel.attachRemote(1, (message) => {
      window.dispatchEvent(new window.MessageEvent('message', { data: message }));
    });
    panel.receiveRemote(1, { type: 'ready' });
    expect(window.document.querySelector('.facepalm .facepalm-feeling')).toBeNull();
    const fresh = await client.markBeat('question', 1);
    expect(fresh?.id).toBe(1);
    panel.post(cue);
    const buttons = window.document.querySelectorAll('.facepalm .facepalm-feeling');
    expect(buttons).toHaveLength(1);
    buttons[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(posted.mock.calls.filter(([message]) => message.type === 'facepalmFeel')).toEqual([
      [{ type: 'facepalmFeel', id: 1, feeling: 'agreement' }],
    ]);
    await vi.waitFor(() => {
      expect(received).toContain('feel 7 agreement');
    });
    expect(received.filter((line) => line.startsWith('feel '))).toHaveLength(1);
  } finally {
    await client.dispose();
    for (const socket of sockets) socket.destroy();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }
    fs.rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await window.happyDOM.abort();
  }
});
