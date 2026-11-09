import { describe, expect, it, vi } from 'vitest';
import { runGpuProcess, type GpuChild } from '../src/speech_gpu_process';

/** A controlled child process that exits only when the test says so. */
function child() {
  const listeners = new Map<string, (value?: unknown) => void>();
  const process: GpuChild = {
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    kill: vi.fn<(signal: 'SIGKILL') => boolean>().mockReturnValue(true),
  };
  return { process, emit: (event: string, value?: unknown) => listeners.get(event)?.(value) };
}

describe('GPU process supervision', () => {
  it('returns only after the child exits', async () => {
    const fake = child();
    const result = runGpuProcess(() => fake.process, 1000);
    fake.emit('close', 0);
    expect(await result).toBe('passed');
  });
  it('kills a timed-out child and waits for its exit before settling', async () => {
    vi.useFakeTimers();
    try {
      const fake = child();
      const settled = vi.fn();
      const result = runGpuProcess(() => fake.process, 10).then(settled);
      await vi.advanceTimersByTimeAsync(10);
      expect(fake.process.kill).toHaveBeenCalledWith('SIGKILL');
      expect(settled).not.toHaveBeenCalled();
      fake.emit('close', 0);
      await result;
      expect(settled).toHaveBeenCalledWith('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
  it('holds the slot if termination throws until the process closes', async () => {
    vi.useFakeTimers();
    try {
      const fake = child();
      vi.mocked(fake.process.kill).mockImplementation(() => { throw new Error('private'); });
      const done = vi.fn();
      const result = runGpuProcess(() => fake.process, 10).then(done);
      await vi.advanceTimersByTimeAsync(10);
      expect(done).not.toHaveBeenCalled();
      fake.emit('close');
      await result;
      expect(done).toHaveBeenCalledWith('timeout');
    } finally { vi.useRealTimers(); }
  });
  it('waits for close after a child error and returns failure', async () => {
    const fake = child();
    const done = vi.fn();
    const result = runGpuProcess(() => fake.process, 1000).then(done);
    fake.emit('error', new Error('private'));
    expect(done).not.toHaveBeenCalled();
    fake.emit('close');
    await result;
    expect(done).toHaveBeenCalledWith('failed');
  });
  it('handles spawn errors and a nonzero child exit as failures', async () => {
    expect(
      await runGpuProcess(() => {
        throw new Error('private');
      }, 10),
    ).toBe('failed');
    const fake = child();
    const result = runGpuProcess(() => fake.process, 1000);
    fake.emit('close', 1);
    expect(await result).toBe('failed');
  });
});
