import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalAudioFrame } from '@ai-pair/protocol';
import { LocalConnection } from '../src/local_connection';

const first = { version: 2, connectionEpoch: 'one', sequence: 1, type: 'attach' };
const heartbeat = { ...first, sequence: 2, type: 'heartbeat' };

afterEach(() => {
  vi.useRealTimers();
});

describe('local audio connection lease', () => {
  it('accepts ordered messages, rejects stale or malformed frames, and expires locally', () => {
    vi.useFakeTimers();
    const receive = vi.fn<(frame: LocalAudioFrame) => void>();
    const lost = vi.fn<() => void>();
    const connection = new LocalConnection({ leaseMs: 100, receive, lost });
    expect(connection.attach(first)).toBe(true);
    expect(connection.attach({ ...first, connectionEpoch: 'two' })).toBe(false);
    expect(connection.accept(heartbeat)).toBe(true);
    expect(connection.accept(heartbeat)).toBe(false);
    expect(connection.accept({ ...heartbeat, sequence: 3, type: 'panelAction', pageEpoch: 1, action: { type: 'ready' } })).toBe(false);
    expect(connection.accept({ ...heartbeat, sequence: 3, type: 'terminal', jobId: 'job', pageEpoch: 1, outcome: 'ended' })).toBe(false);
    expect(connection.accept({ ...heartbeat, sequence: 3, type: 'pause', jobId: 'job', pageEpoch: 1 })).toBe(true);
    expect(connection.accept({ ...heartbeat, sequence: 3, connectionEpoch: 'old' })).toBe(false);
    expect(connection.accept({ ...heartbeat, sequence: 3, secret: 'bad' })).toBe(false);
    expect(receive).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(99);
    expect(lost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(connection.accept({ ...heartbeat, sequence: 4 })).toBe(false);
    expect(connection.attach({ ...first, connectionEpoch: 'two' })).toBe(false);
    connection.dispose();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('can be disposed before attachment without reporting a lost connection', () => {
    const lost = vi.fn<() => void>();
    const connection = new LocalConnection({ leaseMs: 100, receive: vi.fn<(frame: LocalAudioFrame) => void>(), lost });
    connection.dispose();
    expect(connection.attach(first)).toBe(false);
    expect(lost).not.toHaveBeenCalled();
  });

  it('refreshes the lease only for a valid ordered heartbeat and stops on disposal', () => {
    vi.useFakeTimers();
    const lost = vi.fn<() => void>();
    const connection = new LocalConnection({ leaseMs: 100, receive: vi.fn<(frame: LocalAudioFrame) => void>(), lost });
    expect(connection.accept(heartbeat)).toBe(false);
    expect(connection.attach({ ...first, type: 'heartbeat' })).toBe(false);
    expect(connection.attach(first)).toBe(true);
    vi.advanceTimersByTime(80);
    expect(connection.accept(heartbeat)).toBe(true);
    vi.advanceTimersByTime(80);
    expect(lost).not.toHaveBeenCalled();
    connection.dispose();
    expect(lost).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
