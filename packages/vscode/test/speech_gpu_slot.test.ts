import { expect, it, vi } from 'vitest';
import { GpuProcessBusyError, tryAcquireGpuProcessSlot, withGpuProcessSlot } from '../src/speech_gpu_slot';

it('returns retryable busy immediately and retains the current owner until release', async () => {
  const release = tryAcquireGpuProcessSlot();
  expect(release).toBeDefined();
  expect(tryAcquireGpuProcessSlot()).toBeUndefined();
  const operation = vi.fn(() => Promise.resolve('ok'));
  try {
    await expect(withGpuProcessSlot(operation)).rejects.toBeInstanceOf(GpuProcessBusyError);
    expect(operation).not.toHaveBeenCalled();
    expect(tryAcquireGpuProcessSlot()).toBeUndefined();
  } finally {
    release?.();
    release?.();
  }
  expect(await withGpuProcessSlot(operation)).toBe('ok');
  const next = tryAcquireGpuProcessSlot();
  expect(next).toBeDefined();
  next?.();
});

it('releases the slot when work fails', async () => {
  await expect(withGpuProcessSlot(() => Promise.reject(new Error('private')))).rejects.toThrow();
  const release = tryAcquireGpuProcessSlot();
  expect(release).toBeDefined();
  release?.();
});
