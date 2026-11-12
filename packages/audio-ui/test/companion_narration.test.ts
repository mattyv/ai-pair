import { describe, expect, it, vi } from 'vitest';
import type { NarrationPort } from '@ai-pair/core';
import { CompanionNarration } from '../src/companion_narration';

const base = { version: 3 as const, connectionEpoch: 'connection', jobId: '1', pageEpoch: 4 };

function fixture(initialSequence = 0) {
  let sequence = initialSequence;
  const pending = Promise.withResolvers<void>();
  const speak = vi.fn<NarrationPort['speak']>(() => pending.promise);
  const pause = vi.fn<NarrationPort['pause']>();
  const resume = vi.fn<NarrationPort['resume']>();
  const cancel = vi.fn<NarrationPort['cancel']>();
  const send = vi.fn<(_: unknown) => void>();
  const stopOutput = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const observation = vi
    .fn<() => import('../src/speech_host').LocalSpeechObservation | undefined>()
    .mockReturnValueOnce(undefined)
    .mockReturnValue({ id: 1, state: 'idle', started: true, terminal: 'ended' });
  const narration = new CompanionNarration({
    epoch: 'connection',
    speech: { speak, pause, resume, cancel },
    page: () => 4,
    send,
    stopOutput,
    observation,
    nextSequence: () => ++sequence,
  });
  return { narration, speak, pause, resume, cancel, send, pending, stopOutput, observation };
}

describe('companion narration receiver', () => {
  it('plays one current page unit and acknowledges its actual settlement', async () => {
    const { narration, speak, send, pending } = fixture();
    expect(narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(true);
    expect(speak).toHaveBeenCalledWith('Hello.');
    expect(narration.receive({ ...base, type: 'speak', sequence: 2, jobId: '2', text: 'Second.' })).toBe(false);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ jobId: '2', outcome: 'failed' });
    pending.resolve();
    await Promise.resolve();
    expect(send.mock.calls[1]?.[0]).toEqual({ ...base, type: 'terminal', sequence: 2, outcome: 'ended' });
  });

  it('cancels locally before forwarding and cannot resume the canceled owner', async () => {
    const { narration, cancel, resume, send, pending } = fixture();
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    narration.stopLocally();
    narration.stopLocally();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(narration.receive({ ...base, type: 'resume', sequence: 2 })).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    pending.resolve();
    await Promise.resolve();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: 'terminal', outcome: 'canceled' });
  });

  it('rejects stale page and owner controls', () => {
    const { narration, pause, cancel } = fixture();
    expect(narration.receive({ ...base, pageEpoch: 3, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(false);
    expect(narration.receive({ ...base, type: 'speak', sequence: 2, text: 'Hello.' })).toBe(true);
    expect(narration.receive({ ...base, jobId: 'old', type: 'pause', sequence: 3 })).toBe(false);
    expect(narration.receive({ ...base, type: 'pause', sequence: 4 })).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(narration.receive({ ...base, type: 'cancel', sequence: 5 })).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('stops an independently started preview even without a workspace narration job', () => {
    const { narration, cancel } = fixture();
    narration.stopLocally();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('waits for physical silence before forwarding and blocks new speech during the barrier', async () => {
    const { narration, cancel, stopOutput, send } = fixture();
    const retirement = Promise.withResolvers<void>();
    stopOutput.mockReturnValue(retirement.promise);
    const forward = vi.fn<() => void>();
    const action = narration.interruptThen(forward);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(false);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'failed' });
    retirement.resolve();
    await action;
    expect(forward).toHaveBeenCalledTimes(1);
    expect(narration.receive({ ...base, jobId: '2', type: 'speak', sequence: 2, text: 'Hello.' })).toBe(true);
  });
  it('composes local and remote pause reasons without resuming the other reason', () => {
    const { narration, pause, resume } = fixture();
    expect(narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(true);
    narration.setLocalPause(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(narration.receive({ ...base, type: 'pause', sequence: 2 })).toBe(true);
    narration.setLocalPause(false);
    expect(resume).not.toHaveBeenCalled();
    expect(narration.receive({ ...base, type: 'resume', sequence: 3 })).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });
  it('clears the old remote pause after cancellation without reviving that job', async () => {
    const { narration, resume, pending } = fixture();
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    narration.receive({ ...base, type: 'pause', sequence: 2 });
    narration.stopLocally();
    pending.resolve();
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
  });
  it('reports synchronous and asynchronous speech failure without leaking errors', async () => {
    const first = fixture();
    first.speak.mockImplementation(() => {
      throw new Error('private');
    });
    expect(first.narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(true);
    expect(first.send.mock.calls[0]?.[0]).toMatchObject({ type: 'terminal', outcome: 'failed' });
    const second = fixture();
    second.speak.mockRejectedValue(new Error('private'));
    expect(second.narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' })).toBe(true);
    await Promise.resolve();
    expect(second.send.mock.calls[0]?.[0]).toMatchObject({ type: 'terminal', outcome: 'failed' });
    expect(JSON.stringify(second.send.mock.calls)).not.toContain('private');
  });

  it('rejects malformed frames and stops locally on disposal without late acknowledgements', async () => {
    const { narration, cancel, send, pending } = fixture();
    expect(narration.receive({ bad: true })).toBe(false);
    expect(narration.receive({ ...base, type: 'heartbeat', sequence: 1 })).toBe(false);
    expect(narration.receive({ ...base, connectionEpoch: 'old', type: 'speak', sequence: 2, text: 'Hello.' })).toBe(false);
    expect(narration.receive({ ...base, type: 'speak', sequence: 3, text: 'Hello.' })).toBe(true);
    expect(narration.receive({ ...base, type: 'terminal', sequence: 4, outcome: 'ended' })).toBe(false);
    narration.dispose();
    expect(cancel).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(narration.receive({ ...base, type: 'resume', sequence: 5 })).toBe(false);
    await narration.interruptThen(vi.fn<() => void>());
  });

  it('does not forward if local retirement fails or the connection closes', async () => {
    const first = fixture();
    first.stopOutput.mockRejectedValue(new Error('failed'));
    const forward = vi.fn<() => void>();
    await expect(first.narration.interruptThen(forward)).rejects.toThrow('failed');
    expect(forward).not.toHaveBeenCalled();
    const second = fixture();
    const retirement = Promise.withResolvers<void>();
    second.stopOutput.mockReturnValue(retirement.promise);
    const action = second.narration.interruptThen(forward);
    second.narration.dispose();
    retirement.resolve();
    await action;
    expect(forward).not.toHaveBeenCalled();
  });
  it('does not leak or throw when the terminal acknowledgement cannot be sent', async () => {
    const { narration, send, pending } = fixture();
    send.mockImplementation(() => {
      throw new Error('private');
    });
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    pending.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('shares the outgoing sequence with panel actions', async () => {
    const { narration, send, pending } = fixture(10);
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    pending.resolve();
    await Promise.resolve();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ sequence: 11 });
  });
  it('does not claim natural playback when the local speech service resolves without starting', async () => {
    const { narration, send, pending, observation } = fixture();
    observation.mockReset().mockReturnValue(undefined);
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    pending.resolve();
    await Promise.resolve();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: 'terminal', outcome: 'failed' });
  });
  it('rejects duplicate active jobs and controls from a replaced page', () => {
    const { narration, send } = fixture();
    narration.receive({ ...base, type: 'speak', sequence: 1, text: 'Hello.' });
    expect(narration.receive({ ...base, type: 'speak', sequence: 2, text: 'Hello.' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(narration.receive({ ...base, pageEpoch: 3, type: 'pause', sequence: 3 })).toBe(false);
  });
});
