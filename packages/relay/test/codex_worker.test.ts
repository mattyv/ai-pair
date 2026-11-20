import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_ACK_SCHEMA, WORKER_GRANT_SCHEMA, WORKER_MESSAGE_ID_LIMIT, WORKER_TEXT_LIMIT } from '@ai-pair/protocol';
import { runCodexWorker } from '../src/codex_worker';
import type { EditorLink } from '../src/link';

const grant = WORKER_GRANT_SCHEMA.parse({ port: 4567, capability: 'private-grant', model: 'chosen-model' });
const settings = { model: 'chosen-model', prompt: 'Private worker instructions.' };
const ack = WORKER_ACK_SCHEMA.parse({ ok: true });
const init = { id: 1, result: {} };
const thread = { id: 2, result: { thread: { id: 'thread' } } };
const turn = { id: 3, result: { turn: { id: 'turn' } } };
const spawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn }));

afterEach(() => {
  vi.restoreAllMocks();
  spawn.mockReset();
});

/** Encodes fixture records as bytes. */
function records(...values: unknown[]): Buffer {
  return Buffer.from(values.map((value) => `${JSON.stringify(value)}\n`).join(''));
}

/** Makes a provider notification for an exact identity. */
function delta(text: string, itemId = 'first', threadId = 'thread', turnId = 'turn'): unknown {
  return { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: text } };
}

/** Makes the authoritative final form of a provider message. */
function final(text: string, id = 'first'): unknown {
  return { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', id, text } } };
}

/** Makes a terminal turn notification. */
function completed(status: 'completed' | 'failed' = 'completed', id = 'turn'): unknown {
  return { method: 'turn/completed', params: { threadId: 'thread', turn: { id, status } } };
}

/** Stands in for app-server stdio and the exact-window editor relay. */
function setup(signal?: AbortSignal) {
  const child = {
    output: new PassThrough(),
    send: vi.fn<(record: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const link = { callWorker: vi.fn<EditorLink['callWorker']>().mockResolvedValue(ack) };
  const launch = vi.fn(() => child);
  return { child, link, options: { cwd: '/project', launch, signal } };
}

/** Creates an OS-process double whose close is controlled by the test. */
function fakeProcess(stdin: Writable = new PassThrough()) {
  // The Node ChildProcess exposes EventEmitter methods for errors and close.
  // oxlint-disable-next-line unicorn/prefer-event-target
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    kill: vi.fn<(signal: NodeJS.Signals) => boolean>().mockReturnValue(true),
    unref: vi.fn(),
  });
  spawn.mockReturnValue(child);
  return child;
}

/** Emits records from a source whose finalizer fails. */
function noisy(...frames: unknown[]): Iterable<Buffer> {
  return {
    [Symbol.iterator]() {
      const chunks = [records(...frames)].values();
      return {
        next: () => chunks.next(),
        return() {
          throw new Error('private cleanup exception');
        },
      };
    },
  };
}

describe('live Codex worker', () => {
  it('sends exact-turn cumulative snapshots before completion, then finalizes after child close', async () => {
    const { child, link, options } = setup();
    const first = Promise.withResolvers<void>();
    const stop = Promise.withResolvers<void>();
    const closeStarted = Promise.withResolvers<void>();
    link.callWorker.mockImplementation((...[, tool]) => {
      if (tool === 'worker_output') first.resolve();
      return Promise.resolve(ack);
    });
    child.stop.mockImplementationOnce(() => {
      closeStarted.resolve();
      return stop.promise;
    });
    const launched = runCodexWorker([records(grant, settings)], link, options);
    child.output.write(
      Buffer.concat([
        Buffer.from('\r\n'),
        records(
          init,
          thread,
          { method: 'private', params: {} },
          completed('failed', 'other'),
          delta('wrong early', 'first', 'wrong'),
          delta('  partial'),
          turn,
        ),
      ]),
    );
    await first.promise;
    expect(link.callWorker.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [grant.port, 'worker_progress', { capability: grant.capability, text: 'Connecting live Codex output.' }],
      [grant.port, 'worker_output', { capability: grant.capability, text: '  partial', message: 'first' }],
    ]);
    expect(child.stop).not.toHaveBeenCalled();
    child.output.end(
      records(
        delta('secret wrong thread', 'first', 'other'),
        delta('secret wrong turn', 'first', 'thread', 'other'),
        { method: 'item/reasoning/textDelta', params: { threadId: 'thread', turnId: 'turn', delta: 'secret reasoning' } },
        { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'mcpToolCall', text: 'secret tool' } } },
        { id: 'question', method: 'item/tool/requestUserInput', params: { prompt: 'secret question' } },
        { method: 'private' },
        delta(''),
        delta('\ntext  '),
        final('  authoritative  '),
        final('\nsecond\n', 'second'),
        final('duplicate'),
        delta('late'),
        final('', 'third'),
        completed('failed', 'other'),
        completed(),
      ),
    );
    await closeStarted.promise;
    expect(link.callWorker.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [grant.port, 'worker_progress', { capability: grant.capability, text: 'Connecting live Codex output.' }],
      [grant.port, 'worker_output', { capability: grant.capability, text: '  partial', message: 'first' }],
      [grant.port, 'worker_output', { capability: grant.capability, text: '  partial\ntext  ', message: 'first' }],
      [grant.port, 'worker_output', { capability: grant.capability, text: '  authoritative  ', message: 'first', final: true }],
      [grant.port, 'worker_output', { capability: grant.capability, text: '\nsecond\n', message: 'second', final: true }],
    ]);
    expect(child.send.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ id: 1, method: 'initialize' }),
      expect.objectContaining({ method: 'initialized' }),
      expect.objectContaining({
        id: 2,
        method: 'thread/start',
        params: { cwd: '/project', model: settings.model, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' },
      }),
      expect.objectContaining({
        id: 3,
        method: 'turn/start',
        params: { threadId: 'thread', input: [{ type: 'text', text: settings.prompt, text_elements: [] }] },
      }),
      { jsonrpc: '2.0', id: 'question', error: { code: -32_601, message: 'Unsupported Codex request.' } },
    ]);
    stop.resolve();
    expect(await launched).toBe(true);
    expect(link.callWorker.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      grant.port,
      'worker_done',
      { capability: grant.capability, text: 'Codex worker finished.' },
    ]);
  });

  it.each([
    { reason: 'missing settings', records: [grant] },
    { reason: 'missing explicit model', records: [grant, { prompt: settings.prompt }] },
    { reason: 'mismatched model', records: [grant, { ...settings, model: 'other' }] },
    { reason: 'oversized prompt', records: [grant, { ...settings, prompt: 'x'.repeat(WORKER_TEXT_LIMIT + 1) }] },
  ])('releases the grant without launching for $reason', async ({ records: input }) => {
    const { link, options } = setup();
    expect(await runCodexWorker([records(...input)], link, options)).toBe(false);
    expect(options.launch).not.toHaveBeenCalled();
    expect(link.callWorker.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [grant.port, 'worker_done', { capability: grant.capability, text: 'Codex worker failed.' }],
    ]);
  });

  it.each([
    { reason: 'provider failure', frames: [init, thread, turn, completed('failed')] },
    { reason: 'unobserved completion', frames: [init, thread, turn] },
    { reason: 'oversized cumulative message', frames: [init, thread, turn, delta('a'.repeat(WORKER_TEXT_LIMIT)), delta('b'), completed()] },
    { reason: 'oversized message ID', frames: [init, thread, turn, delta('public', 'x'.repeat(WORKER_MESSAGE_ID_LIMIT + 1)), completed()] },
    { reason: 'provider RPC error', frames: [{ id: 1, error: { message: 'secret diagnostics' } }] },
    { reason: 'provider response without result', frames: [{ id: 1 }] },
    { reason: 'delta without an explicit final item', frames: [init, thread, turn, delta('Started'), completed()] },
    { reason: 'empty final after a delta', frames: [init, thread, turn, delta('Started'), final(''), completed()] },
    { reason: 'a credential as an item ID', frames: [init, thread, turn, delta('text', grant.capability), completed()] },
    { reason: 'too many early events', frames: [init, thread, ...Array.from({ length: 65 }, () => delta('x')), turn, completed()] },
    {
      reason: 'too many delta items',
      frames: [init, thread, turn, ...Array.from({ length: 65 }, (_, i) => delta('x', `item-${i}`)), completed()],
    },
    {
      reason: 'too many final items',
      frames: [init, thread, turn, ...Array.from({ length: 65 }, (_, i) => final('x', `item-${i}`)), completed()],
    },
  ])('disposes the child and reports generic failure for $reason', async ({ frames }) => {
    const { child, link, options } = setup();
    child.output.end(records(...frames));
    expect(await runCodexWorker([records(grant, settings)], link, options)).toBe(false);
    expect(child.stop).toHaveBeenCalledOnce();
    expect(link.callWorker.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      grant.port,
      'worker_done',
      { capability: grant.capability, text: 'Codex worker failed.' },
    ]);
  });

  it('aborts a stalled run, awaits child retirement and attempts generic release', async () => {
    const cancellation = new AbortController();
    const { child, link, options } = setup(cancellation.signal);
    const began = Promise.withResolvers<void>();
    child.send.mockImplementationOnce(() => {
      began.resolve();
      return Promise.resolve();
    });
    const launched = runCodexWorker([records(grant, settings)], link, options);
    await began.promise;
    cancellation.abort();
    expect(await launched).toBe(false);
    expect(child.stop).toHaveBeenCalledOnce();
    expect(link.callWorker.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      grant.port,
      'worker_done',
      { capability: grant.capability, text: 'Codex worker failed.' },
    ]);
    child.output.destroy();
  });

  it('keeps the worker grant active when child retirement cannot be confirmed', async () => {
    const { child, link, options } = setup();
    child.stop.mockRejectedValueOnce(new Error('secret process error'));
    child.output.end(records(init, thread, turn, completed()));
    expect(await runCodexWorker([records(grant, settings)], link, options)).toBe(false);
    expect(link.callWorker.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [grant.port, 'worker_progress', { capability: grant.capability, text: 'Connecting live Codex output.' }],
      [
        grant.port,
        'worker_notice',
        { capability: grant.capability, notice: 'blocked', text: 'Codex worker retirement could not be confirmed.' },
      ],
    ]);
  });

  it('requires acknowledgement of the exact worker grant before launching Codex', async () => {
    const { child, link, options } = setup();
    child.output.end(records(init, thread, turn, completed()));
    link.callWorker.mockRejectedValueOnce(new Error('grant no longer active'));
    expect(await runCodexWorker([records(grant, settings)], link, options)).toBe(false);
    expect(options.launch).not.toHaveBeenCalled();
    expect(link.callWorker.mock.calls[0]?.slice(0, 3)).toEqual([
      grant.port,
      'worker_progress',
      { capability: grant.capability, text: 'Connecting live Codex output.' },
    ]);
  });

  it('keeps invalid grant input private and makes no editor calls', async () => {
    const { link, options } = setup();
    expect(await runCodexWorker([records({ port: 0, capability: 'private' }, settings)], link, options)).toBe(false);
    expect(link.callWorker).not.toHaveBeenCalled();
    expect(options.launch).not.toHaveBeenCalled();
  });

  it('fails when the editor cannot acknowledge completion', async () => {
    const { child, link, options } = setup();
    child.output.end(records(init, thread, turn, completed()));
    link.callWorker.mockResolvedValueOnce(ack).mockRejectedValueOnce(new Error('private editor failure'));
    expect(await runCodexWorker([records(grant, settings)], link, options)).toBe(false);
  });

  it('sanitizes iterator errors produced by disposing otherwise successful input and output', async () => {
    const { child, link, options } = setup();
    /** Supplies the failing output fixture as app-server stdout. */
    function launch() {
      return { ...child, output: noisy(init, thread, turn, completed()) };
    }
    expect(await runCodexWorker(noisy(grant, settings), link, { ...options, launch })).toBe(true);
  });

  it('launches installed Codex without a shell or inherited diagnostics and retires after close', async () => {
    const { link } = setup();
    const child = fakeProcess();
    child.kill.mockImplementation(() => {
      child.emit('close');
      return true;
    });
    child.stdout.end(records(init, thread, turn, completed()));
    expect(await runCodexWorker([records(grant, settings)], link, { cwd: '/project' })).toBe(true);
    expect(spawn).toHaveBeenCalledWith('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: '/project',
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false,
    });
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(child.unref).not.toHaveBeenCalled();
    child.stdin.destroy();
  });

  it('sanitizes failed writes and waits for shutdown', async () => {
    const { link } = setup();
    const child = fakeProcess(
      new Writable({
        write(...[, , callback]) {
          callback(new Error('private write failure'));
        },
      }),
    );
    child.kill.mockImplementation(() => {
      child.emit('error', new Error('private process failure'));
      child.emit('close');
      return true;
    });
    expect(await runCodexWorker([records(grant, settings)], link, { cwd: '/project' })).toBe(false);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    child.stdout.destroy();
  });

  it.each([true, false])('escalates termination and requires a close event when force-kill closes: %s', async (closes) => {
    const { link } = setup();
    const child = fakeProcess();
    let retirementWaits = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
      if (duration === 2000 && (retirementWaits++ === 0 || !closes)) return AbortSignal.abort();
      return new AbortController().signal;
    });
    child.kill.mockImplementation((signal) => {
      if (signal === 'SIGKILL' && closes) child.emit('close');
      return true;
    });
    child.stdout.end(records(init, thread, turn, completed()));
    expect(await runCodexWorker([records(grant, settings)], link, { cwd: '/project' })).toBe(closes);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(child.unref.mock.calls.length).toBe(closes ? 0 : 1);
    child.stdin.destroy();
  });
});
