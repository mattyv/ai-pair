import { expect, it, vi } from 'vitest';
import { runGpuTiny, type GpuTinyDependencies } from '../src/speech_gpu_tiny';

function dependencies(): GpuTinyDependencies {
  return {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({ Y: { data: Float32Array.of(1, 4, 9, 16, 25, 36) } }),
      release: vi.fn().mockResolvedValue(undefined),
    }),
    tensor: vi.fn().mockReturnValue({}),
    loader: vi.fn().mockResolvedValue(true),
  };
}
it('requires correct tiny graph output and the expected loader before and after execution', async () => {
  const deps = dependencies();
  expect(await runGpuTiny('/graph', deps)).toBe(true);
  expect(deps.loader).toHaveBeenCalledTimes(2);
});
it('rejects wrong output, unknown loader and errors', async () => {
  const loader = dependencies();
  vi.mocked(loader.loader).mockResolvedValue(false);
  expect(await runGpuTiny('/graph', loader)).toBe(false);
  const bad = dependencies();
  const session = await bad.create('/graph');
  vi.mocked(session.run).mockResolvedValue({ Y: { data: Float32Array.of(1) } });
  expect(await runGpuTiny('/graph', bad)).toBe(false);
  const failed = dependencies();
  vi.mocked(failed.create).mockRejectedValue(new Error('private'));
  expect(await runGpuTiny('/graph', failed)).toBe(false);
});

it('rejects malformed tensor output', async () => {
  const deps = dependencies();
  const session = await deps.create('/graph');
  vi.mocked(session.run).mockResolvedValue({ Y: { data: 'private' } });
  expect(await runGpuTiny('/graph', deps)).toBe(false);
});
