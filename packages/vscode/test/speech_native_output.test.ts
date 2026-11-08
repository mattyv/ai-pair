import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { NativeOutputDriver } from '../src/speech_native_output';

function isCallback(value: unknown): value is (...args: unknown[]) => void {
  return typeof value === 'function';
}

class Child extends PassThrough {
  stdin = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true);
}

describe('native output', () => {
  it('only reports started after the streaming marker, including split chunks', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
    child.stderr.write('stream state changed paused -> str');
    expect(event).not.toHaveBeenCalled();
    child.stderr.write('eaming\n');
    expect(event).toHaveBeenCalledWith('started');
  });
  it('freezes the startup deadline while paused', () => {
    vi.useFakeTimers();
    try {
      const child = new Child();
      const driver = new NativeOutputDriver({ spawn: () => child });
      const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
      expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
      driver.control('pause');
      vi.advanceTimersByTime(30_000);
      expect(event).not.toHaveBeenCalled();
      driver.control('resume');
      child.stderr.write('stream state changed paused -> streaming\n');
      expect(event).toHaveBeenCalledWith('started');
      driver.control('stop');
      child.emit('close', undefined, 'SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops a paused process and retains ownership until it closes', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
    driver.control('pause');
    driver.control('stop');
    expect(child.kill).toHaveBeenCalledWith('SIGSTOP');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(false);
    child.emit('close', undefined, 'SIGKILL');
    expect(event).not.toHaveBeenCalledWith('ended');
  });
  it('keeps a timed-out child owned until close and ignores its late readiness', () => {
    vi.useFakeTimers();
    try {
      const child = new Child();
      const driver = new NativeOutputDriver({ spawn: () => child });
      const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
      expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(event).toHaveBeenCalledWith('failed');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.stderr.write('stream state changed paused -> streaming\n');
      expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(false);
      child.emit('close', 1);
      expect(event).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports natural completion once and ignores old child events after a new job', () => {
    const first = new Child();
    const second = new Child();
    let next = first;
    const driver = new NativeOutputDriver({ spawn: () => next });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
    first.stderr.write('stream state changed paused -> streaming\n');
    first.emit('close', 0);
    expect(event.mock.calls.map((call) => call[0])).toEqual(['started', 'ended']);
    next = second;
    expect(driver.play('sink_a', new Uint8Array(44), event)).toBe(true);
    first.stderr.write('stream state changed paused -> streaming\n');
    expect(event).toHaveBeenCalledTimes(2);
    second.emit('close', 1);
    expect(event).toHaveBeenLastCalledWith('failed');
  });
  it('defers a readiness notification observed during pause until resume', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    driver.play('sink_a', new Uint8Array(44), event);
    driver.control('pause');
    child.stderr.write('stream state changed paused -> streaming\n');
    expect(event).not.toHaveBeenCalled();
    driver.control('resume');
    expect(event).toHaveBeenCalledWith('started');
    driver.control('stop');
    child.emit('close', 1);
  });
  it('rejects malformed targets and invalid waveform sizes without spawning', () => {
    const make = vi.fn(() => new Child());
    const driver = new NativeOutputDriver({ spawn: make });
    expect(driver.play('../sink', new Uint8Array(44), vi.fn<(event: 'started' | 'ended' | 'failed') => void>())).toBe(false);
    expect(driver.play('sink', new Uint8Array(43), vi.fn<(event: 'started' | 'ended' | 'failed') => void>())).toBe(false);
    expect(driver.play('sink', new Uint8Array(1_948_845), vi.fn<(event: 'started' | 'ended' | 'failed') => void>())).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });
  it('fails closed on spawn and stream errors', () => {
    const driver = new NativeOutputDriver({
      spawn: () => {
        throw new Error('private');
      },
    });
    expect(driver.play('sink', new Uint8Array(44), vi.fn<(event: 'started' | 'ended' | 'failed') => void>())).toBe(false);
    const child = new Child();
    const second = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    second.play('sink', new Uint8Array(44), event);
    child.emit('error', new Error('private'));
    expect(event).toHaveBeenCalledWith('failed');
    child.emit('close', 1);
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('fails when a child exits before readiness and ignores output after stop', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    driver.control('pause');
    driver.play('sink', new Uint8Array(44), event);
    child.stdin.emit('error', new Error('closed'));
    child.emit('close', 0);
    expect(event).toHaveBeenCalledWith('failed');
    child.stderr.write('stream state changed paused -> streaming\n');
    expect(event).toHaveBeenCalledTimes(1);
  });
  it('pauses and resumes a started job without restarting the startup deadline', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    driver.play('sink', new Uint8Array(44), event);
    child.stderr.write('stream state changed paused -> streaming\n');
    driver.control('pause');
    driver.control('pause');
    driver.control('resume');
    driver.control('resume');
    expect(child.kill.mock.calls.map((call) => call[0])).toEqual(['SIGSTOP', 'SIGCONT']);
    driver.control('stop');
    child.stderr.write('stream state changed paused -> streaming\n');
    child.emit('close', 1);
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('ignores callbacks retained from a retired process', () => {
    const old = new Child();
    const current = new Child();
    let next = old;
    const driver = new NativeOutputDriver({ spawn: () => next });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    driver.play('sink', new Uint8Array(44), event);
    const close = old.listeners('close')[0];
    const failure = old.listeners('error')[0];
    if (!isCallback(close) || !isCallback(failure)) throw new Error('Missing callback');
    old.emit('close', 1);
    next = current;
    driver.play('sink', new Uint8Array(44), event);
    close(0);
    failure(new Error('late'));
    expect(event).toHaveBeenCalledTimes(1);
    driver.control('stop');
    current.emit('close', 1);
  });
  it('fails closed if writing audio throws synchronously', () => {
    const child = new Child();
    vi.spyOn(child.stdin, 'end').mockImplementation(() => {
      throw new Error('closed');
    });
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.play('sink', new Uint8Array(44), event)).toBe(true);
    expect(event).toHaveBeenCalledWith('failed');
    driver.control('pause');
    child.emit('close', 1);
  });
  it('ignores a process error after cancellation', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    driver.play('sink', new Uint8Array(44), event);
    driver.control('stop');
    child.emit('error', new Error('late'));
    child.emit('close', 1);
    expect(event).not.toHaveBeenCalled();
  });

  it('does not allow another route until the stopped process actually closes', () => {
    const child = new Child();
    const driver = new NativeOutputDriver({ spawn: () => child });
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.available()).toBe(true);
    driver.play('sink', new Uint8Array(44), event);
    expect(driver.available()).toBe(false);
    driver.control('stop');
    expect(driver.available()).toBe(false);
    child.emit('close', 1);
    expect(driver.available()).toBe(true);
  });
});
