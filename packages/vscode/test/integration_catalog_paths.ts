// Controlled HTTP boundary: the real legacy client and catalog never contact ElevenLabs.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import type { Report } from '@ai-pair/protocol';
import type { Api } from '../src/extension';
import { cloudCompanionHost } from './integration_cloud_companion_host';
import { cloudServicePaths } from './integration_cloud_service_paths';
import { gpuProcessPaths } from './integration_gpu_process';

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
  const extension = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(extension && !extension.isActive, 'main extension must be inactive before installing the HTTP boundary');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const promptDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showInputBox');
  const commandDescriptor = Object.getOwnPropertyDescriptor(vscode.commands, 'executeCommand');
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let placementTimerCleared = false;
  let placementTimer: ReturnType<typeof setTimeout> | undefined;
  assert.ok(fetchDescriptor && promptDescriptor && commandDescriptor);
  const executeCommand = vscode.commands.executeCommand;
  const placement = Promise.withResolvers<unknown>();
  let prepareCalled = false;
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
        requests++;
        if (url.origin === 'https://api.elevenlabs.io' && url.pathname === '/v1/text-to-speech/test_voice' && init?.method === 'POST') {
          return Promise.resolve(new Response('private provider response', { status: 429 }));
        }
        if (url.origin !== 'https://api.elevenlabs.io' || url.pathname !== '/v2/voices' || init?.method !== 'GET') {
          return Promise.reject(new Error('Unexpected ElevenLabs request'));
        }
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
    // Delay the private placement boundary while exercising the real controller.
    Object.defineProperty(vscode.commands, 'executeCommand', {
      ...commandDescriptor,
      value: (name: string, ...args: unknown[]) => {
        if (name === 'aiPair.localAudio.prepare') {
          prepareCalled = true;
          return placement.promise;
        }
        return executeCommand(name, ...args);
      },
    });
    // Hold the placement deadline while the real controller plays the batches.
    // The placement owner's own tests cover expiry; this fixture tests pending readiness.
    globalThis.clearTimeout = (timer) => {
      if (timer === placementTimer && timer !== undefined) placementTimerCleared = true;
      realClearTimeout(timer);
    };
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      writable: true,
      value: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        if (delay === 1500 && placementTimer === undefined) {
          placementTimer = realSetTimeout(() => {}, 2_147_483_647);
          globalThis.setTimeout = realSetTimeout;
          return placementTimer;
        }
        return realSetTimeout(callback, delay, ...args);
      },
    });
    api = await extension.activate();
    assert.ok(prepareCalled, 'placement boundary was not invoked');
    assert.ok(placementTimer !== undefined, 'placement deadline was not controlled');
    let placementFinished = false;
    void api.ready.then(() => {
      placementFinished = true;
    });
    api.controller.setSpeed(20);
    api.controller.setReadingSpeed(100);
    await api.controller.start('pending speech readiness');
    for (let index = 0; index < 2; index++) {
      const pending: Report = await api.controller.step([{ say: 'Pending.', speak: false }]);
      assert.equal(pending.speechReminder, undefined, 'pending placement must not prompt for speech');
    }
    const reporting = Promise.withResolvers<void>();
    const trace = api.controller.trace;
    api.controller.trace = (line) => {
      trace?.(line);
      if (line.startsWith('report to step:')) reporting.resolve();
    };
    try {
      let thirdFinished = false;
      const third = api.controller.step([{ say: 'Pending.', speak: false }]).then((result) => {
        thirdFinished = true;
        return result;
      });
      const timeout = Promise.withResolvers<void>();
      const timer = setTimeout(() => {
        timeout.reject(new Error('the third pending report did not reach readiness'));
      }, 5000);
      try {
        await Promise.race([reporting.promise, timeout.promise]);
      } finally {
        clearTimeout(timer);
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      assert.equal(placementFinished, false, 'placement must stay pending');
      assert.equal(thirdFinished, false, 'the readiness check must wait for placement');
      assert.equal(requests, 0, 'pending readiness must not contact the provider');
      placement.resolve(undefined);
      const thirdReport = await third;
      assert.equal(thirdReport.speechReminder, undefined, 'unavailable speech must not prompt');
    } finally {
      api.controller.trace = trace;
    }
    await api.controller.end();
    await api.ready;
    assert.equal(placementTimerCleared, true, 'placement did not clear the controlled deadline');
    globalThis.clearTimeout = realClearTimeout;
    Object.defineProperty(vscode.commands, 'executeCommand', commandDescriptor);
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

    // The real relay must carry the readiness-gated reminder without a synthesis request.
    await vscode.commands.executeCommand('aiPair.narration.focus');
    for (let attempt = 0; attempt < 100 && !api.speechPageReady(); attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.ok(api.speechPageReady(), 'the legacy panel did not become ready');
    api.panelMessage({ type: 'speechSettings', value: { ...value, enabled: true, elevenLabsVoice: 'test_voice' } });
    for (let attempt = 0; attempt < 100 && vscode.workspace.getConfiguration('aiPair').get('speech.enabled') !== true; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    assert.equal(vscode.workspace.getConfiguration('aiPair').get('speech.enabled'), true);
    const agent = new Client({ name: 'speech-reminder-integration', version: '0' });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(root !== undefined && root !== '', 'fixture requires a workspace');
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    await agent.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env }));
    try {
      api.controller.setSpeed(20);
      const start = await agent.callTool({ name: 'start', arguments: { task: 'speech reminder' } });
      assert.notEqual(start.isError, true);
      const before = requests;
      for (let index = 0; index < 3; index++) {
        const result = await agent.callTool({ name: 'step', arguments: { actions: [{ say: 'A short explanation.', speak: false }] } });
        assert.notEqual(result.isError, true);
        if (index === 2) assert.match(JSON.stringify(result.content), /Speech is available.*nothing it could speak/);
      }
      assert.equal(requests, before, 'a reminder must not contact the provider');
      await agent.callTool({ name: 'end', arguments: {} });
    } finally {
      await agent.close();
    }

    // The native host records the safe category from a real SpeechService request.
    const previousNarration = Math.max(0, ...(await events(api)).map((event) => event.seq));
    await api.previewSpeech();
    const failures = await events(api);
    assert.ok(
      failures.some(
        (event) =>
          event.seq > previousNarration &&
          event.kind === 'speech' &&
          event.event === 'narration' &&
          event.provider === 'elevenlabs' &&
          event.phase === 'failed' &&
          event.reason === 'rate',
      ),
      'the main host did not copy the cloud narration failure',
    );
    assert.doesNotMatch(JSON.stringify(failures), /private provider response|ai-pair-integration-dummy-key/);
    await cloudCompanionHost();
    await cloudServicePaths();
    await gpuProcessPaths();

    for (const reason of ['auth', 'network', 'invalid']) {
      mode = reason;
      await catalog(api, 'failed', reason);
    }
    assert.ok(requests >= 6, 'the controlled HTTP boundary did not receive each catalog request');
  } finally {
    placement.resolve(undefined);
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    clearTimeout(placementTimer);
    Object.defineProperty(vscode.commands, 'executeCommand', commandDescriptor);
    Object.defineProperty(vscode.window, 'showInputBox', promptDescriptor);
    try {
      if (api !== undefined) await vscode.commands.executeCommand('aiPair.removeElevenLabsKey');
    } finally {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
      for (const [index, key] of keys.entries()) await settings.update(key, original[index], vscode.ConfigurationTarget.Global);
    }
  }
}
