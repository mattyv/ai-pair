import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionReconnect } from '../src/companion_reconnect';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A reconnect whose attempts answer as the test says, recording each epoch tried. */
function harness(answers: boolean[]): {
  reconnect: CompanionReconnect;
  epochs: string[];
  failed: ReturnType<typeof vi.fn<() => void>>;
  connected: ReturnType<typeof vi.fn<(attempts: number) => void>>;
} {
  const epochs: string[] = [];
  let next = 0;
  const failed = vi.fn<() => void>();
  const connected = vi.fn<(attempts: number) => void>();
  const reconnect = new CompanionReconnect({
    delaysMs: [100, 200, 300],
    newEpoch: () => `epoch-${++next}`,
    attempt: (epoch) => {
      epochs.push(epoch);
      return Promise.resolve(answers.shift() ?? false);
    },
    connected,
    failed,
  });
  return { reconnect, epochs, failed, connected };
}

describe('reconnecting to Local Audio (#127)', () => {
  it('Attempt, WorkspaceAck: retries after each delay with a new epoch, and stops once one connects', async () => {
    const h = harness([false, true]);
    h.reconnect.start();
    await vi.advanceTimersByTimeAsync(99);
    expect(h.epochs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.epochs).toEqual(['epoch-1']);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.epochs).toEqual(['epoch-1', 'epoch-2']);
    expect(h.connected).toHaveBeenCalledExactlyOnceWith(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.epochs).toHaveLength(2);
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('NoNeedlessWarning: warns only once every attempt has failed', async () => {
    const h = harness([false, false, false]);
    h.reconnect.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.epochs).toEqual(['epoch-1', 'epoch-2', 'epoch-3']);
    expect(h.failed).toHaveBeenCalledOnce();
    expect(h.connected).not.toHaveBeenCalled();
  });

  it('treats an attempt that throws as failed, ignores a second start while one runs, and can start again after a loss', async () => {
    const epochs: string[] = [];
    const connected = vi.fn<(attempts: number) => void>();
    const reconnect = new CompanionReconnect({
      delaysMs: [100, 100],
      newEpoch: () => `e${epochs.length + 1}`,
      attempt: (epoch) => {
        epochs.push(epoch);
        return epochs.length === 1 ? Promise.reject(new Error('link down')) : Promise.resolve(true);
      },
      connected,
      failed: vi.fn<() => void>(),
    });
    reconnect.start();
    reconnect.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(epochs).toEqual(['e1', 'e2']);
    expect(connected).toHaveBeenCalledExactlyOnceWith(2);
    reconnect.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(epochs).toEqual(['e1', 'e2', 'e3']);
    expect(connected).toHaveBeenLastCalledWith(1);
  });

  it('stops trying once disposed, as the window closes', async () => {
    const h = harness([false, false, false]);
    h.reconnect.start();
    await vi.advanceTimersByTimeAsync(100);
    h.reconnect.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.epochs).toEqual(['epoch-1']);
    expect(h.failed).not.toHaveBeenCalled();
    h.reconnect.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.epochs).toEqual(['epoch-1']);
  });

  it('reports nothing for an attempt that settles after the window began closing', async () => {
    const pending = Promise.withResolvers<boolean>();
    const connected = vi.fn<(attempts: number) => void>();
    const failed = vi.fn<() => void>();
    const reconnect = new CompanionReconnect({
      delaysMs: [100],
      newEpoch: () => 'e1',
      attempt: () => pending.promise,
      connected,
      failed,
    });
    reconnect.start();
    await vi.advanceTimersByTimeAsync(100);
    reconnect.dispose();
    pending.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(connected).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
