import { expect, it, vi } from 'vitest';
import { mock, mockDeep } from 'vitest-mock-extended';
import * as vscode from 'vscode';
import { NarrationPanel, type PanelWiring } from '../src/panel';
import { OpenRouterClient } from '../src/speech_openrouter';

vi.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({ path, toString: () => path }),
    joinPath: (base: { path: string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join('/'),
      toString: () => [base.path, ...parts].join('/'),
    }),
  },
  commands: { executeCommand: vi.fn(async () => {}) },
  window: {},
}));
vi.mock('../src/panel_html', () => ({ panelHtml: () => '<html>', SPEEDS: [1], READING_SPEEDS: [1] }));

interface Message {
  type: string;
  document?: { pageId: number; documentGeneration: number };
  probeId?: number;
  requestId?: number;
  token?: string;
}
function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}
function open(panel: NarrationPanel): { send: (value: unknown) => void; close: () => void; posted: unknown[] } {
  const posted: unknown[] = [];
  const webview = mock<vscode.Webview>({ cspSource: 'test' });
  webview.asWebviewUri.mockImplementation((uri) => uri);
  webview.postMessage.mockImplementation((message: unknown) => {
    posted.push(message);
    return Promise.resolve(true);
  });
  const view = mock<vscode.WebviewView>({ webview });
  panel.resolveWebviewView(view);
  const receive = webview.onDidReceiveMessage.mock.lastCall?.[0];
  const dispose = view.onDidDispose.mock.lastCall?.[0];
  if (receive === undefined || dispose === undefined) throw new Error('Missing view listeners');
  return {
    send: (value) => {
      receive(value);
    },
    close: () => {
      dispose();
    },
    posted,
  };
}
function harness(): { panel: NarrationPanel; wiring: ReturnType<typeof mockDeep<PanelWiring>> } {
  const wiring = mockDeep<PanelWiring>();
  const controller = mock<ReturnType<PanelWiring['controller']>>();
  const calibration = mock<ReturnType<PanelWiring['calibration']>>();
  wiring.controller.mockReturnValue(controller);
  wiring.calibration.mockReturnValue(calibration);
  wiring.starter.available.mockResolvedValue(true);
  wiring.speech.supported.mockReturnValue(false);
  wiring.speech.modelStatus.mockResolvedValue({
    path: '/model',
    source: 'https://example.test',
    revision: 'test',
    verified: false,
    download: 'missing',
  });
  wiring.speech.installed.mockResolvedValue(false);
  wiring.speech.cloudSupported.mockReturnValue(false);
  wiring.speech.settings.get.mockReturnValue({
    enabled: false,
    provider: 'kokoro',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  });
  wiring.speech.computeState.mockReturnValue({ requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  wiring.speech.outputView.mockReturnValue({ supported: false, devices: [], selected: { kind: 'default' } });
  wiring.speech.readiness = undefined;
  const option = { get: () => 1, set: vi.fn<(value: number) => void>() };
  const panel = new NarrationPanel(
    (file) => file,
    option,
    option,
    { current: () => undefined, ref: () => undefined },
    () => {},
    vscode.Uri.file('/extension'),
    wiring,
    { get: () => 'newestFirst', set: vi.fn<(value: 'newestFirst' | 'oldestFirst') => void>() },
    { version: 'test', build: 'test' },
    { get: () => false, set: vi.fn<(value: boolean) => void>() },
    () => false,
    { get: () => 'typing', set: vi.fn<(value: 'typing' | 'lines' | 'blocks') => void>() },
    { get: () => 'interrupt', set: vi.fn<(value: 'interrupt' | 'finishAction') => void>() },
  );
  return { panel, wiring };
}
function last(posted: unknown[], type: string): Message {
  const message = posted.findLast((value) => isMessage(value) && value.type === type);
  if (!isMessage(message)) throw new Error(`Missing ${type}`);
  return message;
}
const firstToken = '00000000-0000-4000-8000-000000000001';
const secondToken = '00000000-0000-4000-8000-000000000002';
function boot(view: ReturnType<typeof open>, token: string): Message {
  view.send({ type: 'speechDecodeBoot', token });
  const challenge = last(view.posted, 'speechDecodeChallenge');
  view.send({ type: 'speechDecodeBootAck', token, document: challenge.document });
  return challenge;
}

async function admit(panel: NarrationPanel, view: ReturnType<typeof open>, id: number) {
  const pending = panel.admitSpeechDecode(id, new AbortController().signal);
  void pending.catch(() => {});
  await vi.waitFor(() => {
    expect(view.posted.some((value) => isMessage(value) && value.type === 'speechDecodeProbe')).toBe(true);
  });
  const probe = last(view.posted, 'speechDecodeProbe');
  if (probe.document === undefined || probe.probeId === undefined) throw new Error('Missing probe identity');
  view.send({ type: 'speechDecodeReady', token: probe.token, document: probe.document, probeId: probe.probeId, available: true });
  return pending;
}

it('treats visibility changes as logical suspension without destroying a running decode', async () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  boot(view, firstToken);
  const lease = await admit(panel, view, 1);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const canceled = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(last(view.posted, 'speechDecode').requestId).toBeDefined();
  });
  view.send({ type: 'speechPageHidden', pageId: 1 });
  lease.cancel();
  await canceled;
  view.send({ type: 'speechPageVisible', pageId: 1 });
  await expect(panel.admitSpeechDecode(2, new AbortController().signal)).rejects.toThrow();
  const decode = last(view.posted, 'speechDecode');
  view.send({ type: 'speechDecodeDone', token: decode.token, document: decode.document, requestId: decode.requestId });
  (await panel.admitSpeechDecode(3, new AbortController().signal)).cancel();
  view.close();
});

it('retires an old view without destroying a successor document', async () => {
  const { panel } = harness();
  const first = open(panel);
  first.send({ type: 'ready' });
  boot(first, firstToken);
  const oldLease = await admit(panel, first, 1);
  const pending = oldLease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const canceled = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(last(first.posted, 'speechDecode').requestId).toBeDefined();
  });
  const second = open(panel);
  second.send({ type: 'ready' });
  boot(second, secondToken);
  await canceled;
  await expect(panel.admitSpeechDecode(2, new AbortController().signal)).rejects.toThrow();
  first.close();
  const newLease = await admit(panel, second, 2);
  first.close();
  await expect(panel.admitSpeechDecode(3, new AbortController().signal)).rejects.toThrow();
  newLease.cancel();
  second.close();
});

it('never forwards local decoder audio through the remote panel channel', async () => {
  const { panel } = harness();
  const local = open(panel);
  local.send({ type: 'ready' });
  boot(local, firstToken);
  const remote = vi.fn<(message: import('../src/panel_messages').ToPanel) => void>();
  panel.attachRemote(100, remote);
  const pending = panel.admitSpeechDecode(1, new AbortController().signal);
  await expect(pending).rejects.toThrow();
  expect(remote.mock.calls.flat().filter((value: unknown) => isMessage(value) && value.type.startsWith('speechDecode'))).toEqual([]);
  local.close();
});

it('requires a fresh boot acknowledgement for a same-view document reload', async () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  const oldBoot = boot(view, firstToken);
  const oldLease = await admit(panel, view, 1);
  const pending = oldLease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const canceled = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(last(view.posted, 'speechDecode').requestId).toBeDefined();
  });
  view.send({ type: 'speechDecodeBoot', token: secondToken });
  const newBoot = last(view.posted, 'speechDecodeChallenge');
  expect(newBoot.document).not.toEqual(oldBoot.document);
  view.send({ type: 'speechDecodeBootAck', token: firstToken, document: oldBoot.document });
  await expect(panel.admitSpeechDecode(2, new AbortController().signal)).rejects.toThrow();
  view.send({ type: 'speechDecodeBootAck', token: secondToken, document: newBoot.document });
  await canceled;
  const newLease = await admit(panel, view, 3);
  newLease.cancel();
  view.close();
});

it('keeps companion decoder messages on the local webview transport', async () => {
  const { panel } = harness();
  const forward = vi.fn<import('../src/panel').CompanionPanelRouting['forward']>();
  panel.useCompanion({ forward, closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>() });
  const view = open(panel);
  view.send({ type: 'ready' });
  boot(view, firstToken);
  const lease = await admit(panel, view, 1);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const canceled = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(last(view.posted, 'speechDecode').requestId).toBeDefined();
  });
  expect(forward.mock.calls.flat().filter((value: unknown) => isMessage(value) && value.type.startsWith('speechDecode'))).toEqual([]);
  lease.cancel();
  await canceled;
  view.close();
});

it('does not retire an active decoder when a stale boot challenge recovers to the current token', async () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  const currentBoot = boot(view, secondToken);
  const lease = await admit(panel, view, 1);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(last(view.posted, 'speechDecode').requestId).toBeDefined();
  });
  const originalDecode = last(view.posted, 'speechDecode');

  // The document repeats an older token. Its challenge is rejected locally, so it announces its current token again.
  view.send({ type: 'speechDecodeBoot', token: firstToken });
  const staleChallenge = last(view.posted, 'speechDecodeChallenge');
  expect(staleChallenge.token).toBe(firstToken);
  view.send({ type: 'speechDecodeBoot', token: secondToken });
  const recoveredChallenge = last(view.posted, 'speechDecodeChallenge');
  expect(recoveredChallenge.token).toBe(secondToken);
  expect(recoveredChallenge.document).toEqual(currentBoot.document);
  view.send({ type: 'speechDecodeBootAck', token: secondToken, document: currentBoot.document });

  // A repeated boot acknowledgement cannot create fresh decode capacity.
  await expect(panel.admitSpeechDecode(2, new AbortController().signal)).rejects.toThrow();
  view.send({
    type: 'speechDecodeDone',
    token: secondToken,
    document: currentBoot.document,
    requestId: originalDecode.requestId,
  });
  await rejected;
  (await admit(panel, view, 3)).cancel();
  view.close();
});

it('blocks provider requests while an idle decoder waits for a new boot acknowledgement', async () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  boot(view, firstToken);
  (await admit(panel, view, 1)).cancel();
  view.send({ type: 'speechDecodeBoot', token: secondToken });

  const readKey = vi.fn(() => Promise.resolve('secret'));
  const fetcher = vi.fn<typeof fetch>();
  const client = new OpenRouterClient(readKey, fetcher, {
    admit: (id, signal) => panel.admitSpeechDecode(id, signal),
  });
  await expect(
    client.synthesize(
      { id: 2, text: 'hello', modelId: 'vendor/model', voiceId: '', zdr: false, format: 'mp3' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ kind: 'invalid' });
  expect(readKey).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  view.close();
});

it('aborts a deferred credential read when a distinct boot starts before acknowledgement', async () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  boot(view, firstToken);
  (await admit(panel, view, 1)).cancel();

  let resolveKey: ((key: string) => void) | undefined;
  const readKey = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveKey = resolve;
      }),
  );
  const fetcher = vi.fn<typeof fetch>();
  const client = new OpenRouterClient(readKey, fetcher, {
    admit: (id, signal) => panel.admitSpeechDecode(id, signal),
  });
  const pending = client.synthesize(
    { id: 2, text: 'hello', modelId: 'vendor/model', voiceId: '', zdr: false, format: 'mp3' },
    new AbortController().signal,
  );
  await vi.waitFor(() => {
    expect(readKey).toHaveBeenCalledOnce();
  });
  view.send({ type: 'speechDecodeBoot', token: secondToken });
  resolveKey?.('secret');
  await expect(pending).rejects.toMatchObject({ kind: 'canceled' });
  expect(fetcher).not.toHaveBeenCalled();
  view.close();
});
