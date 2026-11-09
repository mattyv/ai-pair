import { expect, it, vi } from 'vitest';
import { setupGpuFlow } from '../src/speech_gpu_setup_flow';
import { GpuModelTimeoutError } from '../src/speech_gpu_model_error';
import { GpuProcessBusyError } from '../src/speech_gpu_client';
vi.mock('../src/speech_gpu_client', () => ({ GpuProcessBusyError: class extends Error {} }));
vi.mock('../src/speech_gpu_model_error', () => ({ GpuModelTimeoutError: class extends Error {} }));

it('PreflightBeforeDownload: does not download when preflight or the CPU model is unavailable', async () => {
  const download = vi.fn();
  const base = {
    preflight: vi.fn().mockResolvedValue({ phase: 'unavailable', reason: 'no_hardware' }),
    cpuModel: vi.fn(),
    gpuModel: vi.fn(),
    download,
    verify: vi.fn(),
    signal: new AbortController().signal,
    progress: vi.fn(),
  };
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
  base.preflight.mockResolvedValue({ phase: 'ready' });
  base.cpuModel.mockResolvedValue(undefined);
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  expect(download).not.toHaveBeenCalled();
});

it('downloads only on explicit setup, reports bounded bytes, and requires full verification', async () => {
  const progress = vi.fn<(value: import('../src/speech_compute_types').GpuCheckProgress) => void>();
  const verify = vi.fn().mockResolvedValue({ phase: 'unavailable', reason: 'probe_failed' });
  const download = vi.fn((report: (bytes: number) => void) => {
    report(2);
    report(999_999_999);
    return Promise.resolve('/gpu');
  });
  const result = await setupGpuFlow({
    preflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
    cpuModel: vi.fn().mockResolvedValue('/cpu'),
    gpuModel: vi.fn().mockResolvedValue(undefined),
    download,
    verify,
    signal: new AbortController().signal,
    progress,
  });
  expect(progress).toHaveBeenCalledWith({ stage: 'download', current: 325_532_232, total: 325_532_232 });
  expect(progress).toHaveBeenLastCalledWith({ stage: 'check' });
  expect(verify).toHaveBeenCalledWith('/gpu');
  expect(result).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});

it('uses a cached model and fails closed for invalid or rejected proof results', async () => {
  const download = vi.fn();
  const base = {
    preflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
    cpuModel: vi.fn().mockResolvedValue('/cpu'),
    gpuModel: vi.fn().mockResolvedValue('/gpu'),
    download,
    verify: vi.fn().mockResolvedValue({ phase: 'ready' }),
    signal: new AbortController().signal,
    progress: vi.fn<(value: import('../src/speech_compute_types').GpuCheckProgress) => void>(),
  };
  expect(await setupGpuFlow(base)).toEqual({ phase: 'ready' });
  expect(download).not.toHaveBeenCalled();
  base.preflight.mockResolvedValueOnce({ phase: 'checking' });
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  base.verify.mockResolvedValueOnce({ phase: 'idle' });
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  base.verify.mockRejectedValueOnce(new Error('private'));
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  base.preflight.mockRejectedValueOnce(new Error('private'));
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  base.cpuModel.mockRejectedValueOnce(new Error('private'));
  expect(await setupGpuFlow(base)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
});

it('ignores invalid and stale progress and uses the pinned default total', async () => {
  let report: ((bytes: number) => void) | undefined;
  const progress = vi.fn<(value: import('../src/speech_compute_types').GpuCheckProgress) => void>();
  const result = await setupGpuFlow({
    preflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
    cpuModel: vi.fn().mockResolvedValue('/cpu'),
    gpuModel: vi.fn().mockResolvedValue(undefined),
    download: (callback) => {
      report = callback;
      callback(Number.NaN);
      callback(0);
      callback(-1);
      callback(1);
      return Promise.resolve('/gpu');
    },
    verify: vi.fn().mockResolvedValue({ phase: 'ready' }),
    signal: new AbortController().signal,
    progress,
  });
  expect(result).toEqual({ phase: 'ready' });
  expect(progress).toHaveBeenCalledWith({ stage: 'download', current: 1, total: 325_532_232 });
  const count = progress.mock.calls.length;
  report?.(2);
  expect(progress).toHaveBeenCalledTimes(count);
});

it('drops results when canceled at each asynchronous setup boundary', async () => {
  for (const boundary of ['before', 'preflight', 'cpu', 'gpu', 'download', 'verify'] as const) {
    const abort = new AbortController();
    if (boundary === 'before') abort.abort();
    function hit<T>(name: string, value: T): Promise<T> {
      if (boundary === name) abort.abort();
      return Promise.resolve(value);
    }
    const result = await setupGpuFlow({
      preflight: () => hit('preflight', { phase: 'ready' }),
      cpuModel: () => hit('cpu', '/cpu'),
      gpuModel: () => hit('gpu', undefined),
      download: () => hit('download', '/gpu'),
      verify: () => hit('verify', { phase: 'ready' }),
      signal: abort.signal,
      progress: () => {},
    });
    expect(result).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  }
});

it('ignores progress after cancellation and reports model setup errors safely', async () => {
  const abort = new AbortController();
  const progress = vi.fn<(value: import('../src/speech_compute_types').GpuCheckProgress) => void>();
  const common = {
    preflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
    cpuModel: vi.fn().mockResolvedValue('/cpu'),
    gpuModel: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue({ phase: 'ready' }),
    progress,
  };
  const result = await setupGpuFlow({
    ...common,
    signal: abort.signal,
    download: (report) => {
      abort.abort();
      report(1);
      return Promise.resolve('/gpu');
    },
  });
  expect(result).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  expect(progress).not.toHaveBeenCalled();
  const rejected = new AbortController();
  expect(
    await setupGpuFlow({
      ...common,
      signal: rejected.signal,
      download: () => {
        rejected.abort();
        return Promise.reject(new Error('private'));
      },
    }),
  ).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  expect(
    await setupGpuFlow({ ...common, signal: new AbortController().signal, download: () => Promise.reject(new Error('private')) }),
  ).toEqual({ phase: 'unavailable', reason: 'model_missing' });
});

it('reports a model download timeout as a fixed timeout reason', async () => {
  const result = await setupGpuFlow({
    preflight: () => Promise.resolve({ phase: 'ready' }),
    cpuModel: () => Promise.resolve('/cpu'),
    gpuModel: () => Promise.resolve(undefined),
    download: () => Promise.reject(new GpuModelTimeoutError()),
    verify: () => Promise.resolve({ phase: 'ready' }),
    signal: new AbortController().signal,
    progress: () => {},
  });
  expect(result).toEqual({ phase: 'unavailable', reason: 'timeout' });
});

it('reports a busy proof slot as retryable without exposing exception details', async () => {
  const result = await setupGpuFlow({
    preflight: () => Promise.reject(new GpuProcessBusyError()),
    cpuModel: () => Promise.resolve('/cpu'),
    gpuModel: () => Promise.resolve('/gpu'),
    download: () => Promise.resolve('/gpu'),
    verify: () => Promise.resolve({ phase: 'ready' }),
    signal: new AbortController().signal,
    progress: () => {},
  });
  expect(result).toEqual({ phase: 'unavailable', reason: 'busy' });
});
