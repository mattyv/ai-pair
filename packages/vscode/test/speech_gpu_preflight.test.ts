import { GpuProcessBusyError } from '../src/speech_gpu_slot';
import { expect, it, vi } from 'vitest';
import { preflightGpu, type GpuPreflightDependencies } from '../src/speech_gpu_preflight';

function deps(): GpuPreflightDependencies {
  return {
    supported: true,
    runtimeAvailable: vi.fn().mockResolvedValue(true),
    trust: vi.fn().mockResolvedValue(true),
    enumerate: vi.fn().mockResolvedValue(true),
  };
}
it('checks runtime, trusted loader and physical AMD before any model download', async () => {
  const value = deps();
  expect(await preflightGpu(value)).toEqual({ phase: 'ready' });
  expect(value.trust).toHaveBeenCalledOnce();
  expect(value.enumerate).toHaveBeenCalledOnce();
});
it('fails closed early for missing runtime, untrusted driver or absent hardware', async () => {
  const unsupported = deps();
  unsupported.supported = false;
  expect(await preflightGpu(unsupported)).toEqual({ phase: 'unavailable', reason: 'unsupported' });
  const missing = deps();
  vi.mocked(missing.runtimeAvailable).mockResolvedValue(false);
  expect(await preflightGpu(missing)).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  expect(missing.trust).not.toHaveBeenCalled();
  const untrusted = deps();
  vi.mocked(untrusted.trust).mockResolvedValue(false);
  expect(await preflightGpu(untrusted)).toEqual({ phase: 'unavailable', reason: 'untrusted_driver' });
  expect(untrusted.enumerate).not.toHaveBeenCalled();
  const noHardware = deps();
  vi.mocked(noHardware.enumerate).mockResolvedValue(false);
  expect(await preflightGpu(noHardware)).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
});

it('maps an unexpected hardware exception to a fixed unavailable reason', async () => {
  const value = deps();
  vi.mocked(value.enumerate).mockRejectedValue(new Error('private'));
  expect(await preflightGpu(value)).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
});

it('returns retryable busy when a physical probe already owns the slot', async () => {
  const value = deps();
  vi.mocked(value.enumerate).mockRejectedValue(new GpuProcessBusyError());
  expect(await preflightGpu(value)).toEqual({ phase: 'unavailable', reason: 'busy' });
});
