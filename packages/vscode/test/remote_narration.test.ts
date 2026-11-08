import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteNarration } from '../src/remote_narration';

const fake = vi.hoisted(() => ({ problem: vi.fn<(text: unknown) => string | undefined>() }));
vi.mock('@ai-pair/protocol', async (original) => ({
  ...(await original<typeof import('@ai-pair/protocol')>()),
  speechProblem: fake.problem,
}));
beforeEach(() => {
  fake.problem.mockReset();
});

/** Creates a fresh connection-wide outbound sequence. */
function sequence(): () => number {
  let value = 0;
  return () => ++value;
}

/** Checks a callback captured from the timer fake. */
function isTimerCallback(value: unknown): value is () => void {
  return typeof value === 'function';
}

afterEach(() => {
  vi.useRealTimers();
});

describe('remote narration port', () => {
  it('settles only a matching current terminal and rejects stale acknowledgements', async () => {
    const send = vi.fn<(_: unknown) => void>();
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    const job = port.speak('Short narration.');
    expect(send.mock.calls[0]?.[0]).toEqual({
      version: 1,
      connectionEpoch: 'connection',
      sequence: 1,
      type: 'speak',
      jobId: '1',
      pageEpoch: 4,
      text: 'Short narration.',
    });
    expect(
      port.ack({ version: 1, connectionEpoch: 'old', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' }),
    ).toBe(false);
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 3, outcome: 'ended' }),
    ).toBe(false);
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' }),
    ).toBe(true);
    await job;
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' }),
    ).toBe(false);
  });

  it('settles a timed out caller without admitting another job before retirement', async () => {
    vi.useFakeTimers();
    const send = vi.fn<(_: unknown) => void>();
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    const first = port.speak('One.');
    await vi.advanceTimersByTimeAsync(100);
    await first;
    await port.speak('Two.');
    port.pause();
    port.resume();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ type: 'cancel', jobId: '1' });
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'canceled' }),
    ).toBe(true);
    void port.speak('Three.');
    expect(send.mock.calls[2]?.[0]).toMatchObject({ type: 'speak', jobId: '2' });
    port.dispose();
  });
  it('forwards pause, resume and cancellation once for the current job', async () => {
    const send = vi.fn<(_: unknown) => void>();
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    port.pause();
    port.resume();
    port.cancel();
    const job = port.speak('One.');
    port.pause();
    port.resume();
    port.cancel();
    port.cancel();
    await job;
    expect(send.mock.calls.map(([frame]) => frame)).toMatchObject([
      { type: 'speak', sequence: 1 },
      { type: 'pause', sequence: 2 },
      { type: 'resume', sequence: 3 },
      { type: 'cancel', sequence: 4 },
    ]);
    port.dispose();
    await port.speak('No more.');
  });

  it('fails closed on invalid input and transport errors', async () => {
    vi.useFakeTimers();
    const absent = new RemoteNarration({
      epoch: 'connection',
      page: () => undefined,
      timeoutMs: 100,
      send: vi.fn<(_: unknown) => void>(),
      nextSequence: sequence(),
    });
    await absent.speak('No page.');
    const send = vi.fn<(_: unknown) => void>(() => {
      throw new Error('private');
    });
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    fake.problem.mockReturnValueOnce('invalid');
    await port.speak('x'.repeat(281));
    expect(send).not.toHaveBeenCalled();
    const job = port.speak('One.');
    await vi.advanceTimersByTimeAsync(100);
    await job;
    expect(send).toHaveBeenCalledTimes(2);
    expect(port.ack({ nonsense: true })).toBe(false);
    port.dispose();
  });

  it('rejects a later job acknowledgement with a reused sequence or job id', async () => {
    const port = new RemoteNarration({
      epoch: 'connection',
      page: () => 4,
      timeoutMs: 100,
      send: vi.fn<(_: unknown) => void>(),
      nextSequence: sequence(),
    });
    const first = port.speak('One.');
    const terminal = {
      version: 1,
      connectionEpoch: 'connection',
      sequence: 1,
      type: 'terminal',
      jobId: '1',
      pageEpoch: 4,
      outcome: 'ended',
    };
    expect(port.ack(terminal)).toBe(true);
    await first;
    const second = port.speak('Two.');
    expect(port.ack(terminal)).toBe(false);
    expect(port.ack({ ...terminal, sequence: 2 })).toBe(false);
    expect(port.ack({ ...terminal, jobId: '2' })).toBe(false);
    expect(port.ack({ ...terminal, sequence: 2, jobId: '2' })).toBe(true);
    await second;
    port.dispose();
    expect(port.ack(terminal)).toBe(false);
  });
  it('ignores a timeout callback already queued for an acknowledged job', async () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const send = vi.fn<(_: unknown) => void>();
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    const job = port.speak('One.');
    const callback: unknown = timers.mock.calls[0]?.[0];
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' }),
    ).toBe(true);
    await job;
    if (!isTimerCallback(callback)) throw new Error('No timeout callback');
    callback();
    expect(send).toHaveBeenCalledTimes(1);
    timers.mockRestore();
  });
  it('shares the outbound sequence space with other workspace messages', async () => {
    const send = vi.fn<(_: unknown) => void>();
    let sharedSequence = 10;
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: () => ++sharedSequence });
    const job = port.speak('One.');
    expect(send.mock.calls[0]?.[0]).toMatchObject({ sequence: 11 });
    port.cancel();
    await job;
    expect(send.mock.calls[1]?.[0]).toMatchObject({ sequence: 12 });
  });
  it('freezes the narration watchdog during a long healthy pause', async () => {
    vi.useFakeTimers();
    const send = vi.fn<(_: unknown) => void>();
    const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 100, send, nextSequence: sequence() });
    const job = port.speak('One.');
    await vi.advanceTimersByTimeAsync(40);
    port.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(send.mock.calls.map(([frame]) => frame)).toMatchObject([{ type: 'speak' }, { type: 'pause' }]);
    port.resume();
    await vi.advanceTimersByTimeAsync(59);
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' }),
    ).toBe(true);
    await job;
  });
});

it('keeps a long multipart unit paused and retains its slot after timeout until matching retirement', async () => {
  vi.useFakeTimers();
  const send = vi.fn<(_: unknown) => void>();
  const port = new RemoteNarration({ epoch: 'connection', page: () => 4, timeoutMs: 270_600, send, nextSequence: sequence() });
  const job = port.speak('First. Second. Third. Fourth.');
  await vi.advanceTimersByTimeAsync(120_000);
  port.pause();
  await vi.advanceTimersByTimeAsync(300_000);
  port.resume();
  await vi.advanceTimersByTimeAsync(150_600);
  await job;
  await port.speak('Must wait.');
  expect(send.mock.calls.map(([frame]) => frame)).toMatchObject([
    { type: 'speak' },
    { type: 'pause' },
    { type: 'resume' },
    { type: 'cancel' },
  ]);
  expect(port.ack({ version: 1, connectionEpoch: 'old', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'ended' })).toBe(
    false,
  );
  expect(
    port.ack({ version: 1, connectionEpoch: 'connection', sequence: 1, type: 'terminal', jobId: '1', pageEpoch: 4, outcome: 'canceled' }),
  ).toBe(true);
  void port.speak('Next.');
  expect(send.mock.calls[4]?.[0]).toMatchObject({ type: 'speak', jobId: '2' });
  port.dispose();
});
