import { describe, expect, it, vi } from 'vitest';
import { WORKER_ACK_SCHEMA, WORKER_GRANT_SCHEMA, WORKER_TEXT_LIMIT } from '@ai-pair/protocol';
import type { EditorLink } from '../src/link';
import { forwardCodexWorkerTranscript } from '../src/worker_output';

const grant = WORKER_GRANT_SCHEMA.parse({ port: 4567, capability: 'private-grant', model: 'test-model' });
const ack = WORKER_ACK_SCHEMA.parse({ ok: true });
const success = 'Codex worker finished.';
const failure = 'Codex worker transcript failed.';
const completed = { type: 'turn.completed' };

/** Encodes fixture records in the order the launcher receives them. */
function records(...values: unknown[]): Buffer {
  return Buffer.from(values.map((value) => `${JSON.stringify(value)}\n`).join(''));
}

/** Makes a completed Codex message fixture. */
function message(text: string): unknown {
  return { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } };
}

/** Builds a solitary exact-window link. */
function mockLink() {
  return { callWorker: vi.fn<EditorLink['callWorker']>().mockResolvedValue(ack) };
}

describe('Codex worker transcript', () => {
  it('forwards only completed agent messages in order, preserving text across arbitrary chunks', async () => {
    const link = mockLink();
    const raw = ' \t**Result**\r\n\u{1F3AE}\n\n';
    const payload = Buffer.concat([
      records(grant, { type: 'thread.started' }, { type: 'item.updated', item: { type: 'agent_message', text: 'partial' } }),
      Buffer.from(' \t\r\n'),
      records(
        { type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } },
        { type: 'item.completed', item: { type: 'mcp_tool_call', text: 'tool secret' } },
        { type: 'item.completed', item: { type: 'user_message', text: 'user secret' } },
        { type: 'error', message: 'private diagnostic' },
        message(raw),
        message('last'),
      ),
      Buffer.from(JSON.stringify(completed)),
    ]);
    const character = payload.indexOf('\u{1F3AE}');
    const chunks = [payload.subarray(0, 3), payload.subarray(3, character + 1), payload.subarray(character + 1)];
    expect(await forwardCodexWorkerTranscript(chunks, link)).toBe(true);
    expect(link.callWorker.mock.calls).toEqual([
      [grant.port, 'worker_output', { capability: grant.capability, text: raw }],
      [grant.port, 'worker_output', { capability: grant.capability, text: 'last' }],
      [grant.port, 'worker_done', { capability: grant.capability, text: success }],
    ]);
  });

  it.each([
    { case: 'oversized message text', bad: [records(message('x'.repeat(WORKER_TEXT_LIMIT + 1)))] },
    { case: 'a malformed agent message', bad: [records({ type: 'item.completed', item: { type: 'agent_message', text: 123 } })] },
    { case: 'an unclassifiable completed item', bad: [records({ type: 'item.completed', item: {} })] },
    { case: 'broken JSON', bad: [Buffer.from('invalid private record\n')] },
    { case: 'invalid UTF-8', bad: [Buffer.from([0xff, 0x0a])] },
    {
      case: 'an oversized JSON line spread across chunks',
      bad: [Buffer.from('{"type":"error","message":"'), Buffer.alloc(WORKER_TEXT_LIMIT * 10, 'x'), Buffer.from('"}\n')],
    },
  ])('forwards later bounded output and reports incomplete for $case', async ({ bad }) => {
    const link = mockLink();
    const accepted = '\u0000'.repeat(WORKER_TEXT_LIMIT);
    expect(await forwardCodexWorkerTranscript([records(grant), ...bad, records(message(''), message(accepted), completed)], link)).toBe(
      false,
    );
    expect(link.callWorker.mock.calls).toEqual([
      [grant.port, 'worker_output', { capability: grant.capability, text: accepted }],
      [grant.port, 'worker_done', { capability: grant.capability, text: failure }],
    ]);
  });

  it('reports incomplete for an oversized final record even without a newline', async () => {
    const link = mockLink();
    expect(await forwardCodexWorkerTranscript([records(grant, completed), Buffer.alloc(WORKER_TEXT_LIMIT * 10, 'x')], link)).toBe(false);
    expect(link.callWorker.mock.calls).toEqual([[grant.port, 'worker_done', { capability: grant.capability, text: failure }]]);
  });

  it('does not release the grant until EOF even after seeing completion', async () => {
    const link = mockLink();
    const waiting = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    /** Holds the stream open while the assertion checks the active grant. */
    async function* input() {
      yield records(grant, message('first'), completed);
      waiting.resolve();
      await finish.promise;
      yield records(message('last'));
    }
    const forwarded = forwardCodexWorkerTranscript(input(), link);
    await waiting.promise;
    expect(link.callWorker.mock.calls.map((call) => call[1])).toEqual(['worker_output']);
    finish.resolve();
    expect(await forwarded).toBe(true);
    expect(link.callWorker.mock.calls.map((call) => call[1])).toEqual(['worker_output', 'worker_output', 'worker_done']);
  });

  it.each([
    { case: 'empty input', chunks: [] },
    {
      case: 'an invalid grant followed by a grant-shaped record',
      chunks: [records({ capability: 'private-invalid-grant' }, grant, completed)],
    },
    { case: 'an oversized grant line', chunks: [Buffer.alloc(WORKER_TEXT_LIMIT * 10, 'x')] },
  ])('makes no editor calls for $case', async ({ chunks }) => {
    const link = mockLink();
    expect(await forwardCodexWorkerTranscript(chunks, link)).toBe(false);
    expect(link.callWorker).not.toHaveBeenCalled();
  });

  it.each([
    { case: 'no completion', events: [] },
    { case: 'a failed turn', events: [{ type: 'turn.failed', error: { message: 'private failure' } }, completed] },
  ])('releases the grant with a generic failure for $case', async ({ events }) => {
    const link = mockLink();
    expect(await forwardCodexWorkerTranscript([records(grant, ...events)], link)).toBe(false);
    expect(link.callWorker.mock.calls).toEqual([[grant.port, 'worker_done', { capability: grant.capability, text: failure }]]);
  });

  it('releases the grant with failure when the source fails after completion', async () => {
    const link = mockLink();
    /** Emits a terminal marker before simulating an interrupted pipe. */
    function* input() {
      yield records(grant, completed);
      throw new Error('private source error');
    }
    expect(await forwardCodexWorkerTranscript(input(), link)).toBe(false);
    expect(link.callWorker.mock.calls).toEqual([[grant.port, 'worker_done', { capability: grant.capability, text: failure }]]);
  });

  it('attempts generic failure completion when output is rejected and fails if completion cannot be acknowledged', async () => {
    const link = mockLink();
    link.callWorker.mockRejectedValueOnce(new Error('private editor error')).mockResolvedValueOnce({ ok: false });
    expect(await forwardCodexWorkerTranscript([records(grant, message('undelivered'), completed)], link)).toBe(false);
    expect(link.callWorker.mock.calls.at(-1)).toEqual([grant.port, 'worker_done', { capability: grant.capability, text: failure }]);
    link.callWorker.mockRejectedValueOnce(new Error('private completion error'));
    expect(await forwardCodexWorkerTranscript([records(grant, completed)], link)).toBe(false);
  });
});
