// Controlled HTTP boundary: the real legacy client and catalog never contact ElevenLabs.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { Api } from '../src/extension';

const report = z.object({ events: z.array(z.looseObject({ kind: z.string(), seq: z.number() })) });

/** Reads the extension's sanitized diagnostic events. */
async function events(api: Api): Promise<Array<z.infer<typeof report>['events'][number]>> {
  await vscode.env.clipboard.writeText('');
  api.panelMessage({ type: 'copyDiagnostics' });
  let value = '';
  for (let attempt = 0; attempt < 100 && value === ''; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    value = await vscode.env.clipboard.readText();
  }
  return report.parse(JSON.parse(value)).events;
}

/** Waits for a real catalog diagnostic produced after the given sequence. */
async function catalog(api: Api, phase: string, reason?: string, more = false): Promise<void> {
  const previous = Math.max(0, ...(await events(api)).map((event) => event.seq));
  api.panelMessage({ type: more ? 'speechVoicesMore' : 'speechVoicesLoad' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await events(api)).some(
        (event) =>
          event.seq > previous &&
          event.kind === 'speech' &&
          event.provider === 'elevenlabs' &&
          event.event === 'catalog' &&
          event.phase === phase &&
          event.reason === reason,
      )
    ) {
      return;
    }
  }
  assert.fail(`Catalog did not report ${phase}/${reason ?? 'none'}`);
}

/** Runs the real legacy catalog with locally supplied provider HTTP responses. */
export async function run(): Promise<void> {
  assert.equal(process.platform, 'linux', 'this fixture requires an isolated Linux basic-password profile');
  const extension = vscode.extensions.getExtension<Api>('michalstrba.ai-pair');
  assert.ok(extension && !extension.isActive, 'main extension must be inactive before installing the HTTP boundary');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const promptDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showInputBox');
  assert.ok(fetchDescriptor && promptDescriptor);
  const realFetch = globalThis.fetch;
  let mode = 'empty';
  let requests = 0;
  let sawMore = false;
  let api: Api | undefined;
  const settings = vscode.workspace.getConfiguration('aiPair');
  const keys = [
    'speech.enabled',
    'speech.listeningSpeed',
    'speech.voice',
    'speech.speed',
    'speech.provider',
    'speech.elevenLabsVoice',
    'speech.elevenLabsSpeed',
  ];
  const original = keys.map((key) => settings.inspect<unknown>(key)?.globalValue);
  const value = { enabled: false, voice: 'af_heart', speed: 1, provider: 'elevenlabs', elevenLabsVoice: '', elevenLabsSpeed: 1 };
  try {
    Object.defineProperty(globalThis, 'fetch', {
      ...fetchDescriptor,
      value: (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
        if (url.hostname !== 'api.elevenlabs.io') return realFetch(input, init);
        if (url.origin !== 'https://api.elevenlabs.io' || url.pathname !== '/v2/voices' || init?.method !== 'GET') {
          return Promise.reject(new Error('Unexpected ElevenLabs request'));
        }
        requests++;
        const cursor = url.searchParams.get('next_page_token');
        if (cursor !== null) sawMore = true;
        if (mode === 'auth') return Promise.resolve(new Response('', { status: 401 }));
        if (mode === 'network') return Promise.reject(new Error('injected network failure'));
        if (mode === 'invalid') return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
        const body =
          mode === 'empty'
            ? { voices: [], has_more: false }
            : cursor === null
              ? { voices: [{ voice_id: 'test_voice', name: 'Test voice' }], has_more: true, next_page_token: 'next' }
              : { voices: [{ voice_id: 'other_voice', name: 'Other voice' }], has_more: false };
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
      },
    });
    Object.defineProperty(vscode.window, 'showInputBox', {
      ...promptDescriptor,
      value: () => Promise.resolve('ai-pair-integration-dummy-key'),
    });
    api = await extension.activate();
    await api.ready;
    await vscode.commands.executeCommand('aiPair.setElevenLabsKey');
    api.panelMessage({ type: 'speechSettings', value });
    for (let attempt = 0; attempt < 100 && vscode.workspace.getConfiguration('aiPair').get('speech.provider') !== 'elevenlabs'; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.provider'), 'elevenlabs');
    await catalog(api, 'ready', 'no_voice');
    mode = 'voices';
    await catalog(api, 'ready');
    await catalog(api, 'ready', undefined, true);
    assert.ok(sawMore, 'the next catalog page was not requested');
    api.panelMessage({ type: 'speechSettings', value: { ...value, elevenLabsVoice: 'test_voice' } });
    for (
      let attempt = 0;
      attempt < 100 && vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsVoice') !== 'test_voice';
      attempt++
    ) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.elevenLabsVoice'), 'test_voice');
    for (const reason of ['auth', 'network', 'invalid']) {
      mode = reason;
      await catalog(api, 'failed', reason);
    }
    assert.ok(requests >= 6, 'the controlled HTTP boundary did not receive each catalog request');
  } finally {
    Object.defineProperty(vscode.window, 'showInputBox', promptDescriptor);
    try {
      if (api !== undefined) await vscode.commands.executeCommand('aiPair.removeElevenLabsKey');
    } finally {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
      for (const [index, key] of keys.entries()) await settings.update(key, original[index], vscode.ConfigurationTarget.Global);
    }
  }
}
