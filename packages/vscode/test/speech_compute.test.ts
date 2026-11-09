import { expect, it, vi } from 'vitest';
import { SpeechCompute } from '../src/speech_compute';

it('keeps CPU as the default and reports CPU only when the worker starts', () => {
  const changed = vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>();
  const compute = new SpeechCompute('invalid', () => Promise.resolve({ phase: 'unavailable', reason: 'runtime_missing' }), changed);
  expect(compute.state()).toEqual({ requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  compute.actual('cpu');
  expect(changed).toHaveBeenCalledWith({ requestedMode: 'cpu', actualBackend: 'cpu', gpuCheck: { phase: 'idle' } });
});

it('does not call a verified probe a usable GPU before an inference worker exists', async () => {
  const changed = vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>();
  const compute = new SpeechCompute('gpu', () => Promise.resolve({ phase: 'ready' }), changed);
  await compute.check();
  expect(compute.state()).toEqual({
    requestedMode: 'gpu',
    actualBackend: 'none',
    gpuCheck: { phase: 'unavailable', reason: 'inconclusive' },
  });
});

it('selects a mode and ignores a second check while the first is running', async () => {
  const deferred = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const probe = vi.fn(() => deferred.promise);
  const changed = vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>();
  const compute = new SpeechCompute('auto', probe, changed);
  compute.select('gpu');
  const first = compute.check();
  await compute.check();
  expect(probe).toHaveBeenCalledOnce();
  expect(compute.state()).toEqual({ requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'checking' } });
  deferred.resolve({ phase: 'unavailable', reason: 'no_hardware' });
  await first;
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
});

it('reports a probe exception as a fixed failure', async () => {
  const compute = new SpeechCompute(
    'cpu',
    () => Promise.reject(new Error('private details')),
    vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>(),
  );
  await compute.check();
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});

it('publishes download progress only while its setup check is active', async () => {
  const pending = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  let report: ((value: import('../src/speech_compute_types').GpuCheckProgress) => void) | undefined;
  const compute = new SpeechCompute(
    'gpu',
    (progress) => {
      report = progress;
      return pending.promise;
    },
    vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>(),
  );
  const check = compute.check();
  report?.({ stage: 'download', current: 100, total: 200 });
  expect(compute.state().gpuCheck).toEqual({ phase: 'checking', progress: { stage: 'download', current: 100, total: 200 } });
  pending.resolve({ phase: 'unavailable', reason: 'no_hardware' });
  await check;
  report?.({ stage: 'verify' });
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
});

it('reports an Auto fallback reason without replacing an active setup check', async () => {
  const pending = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const compute = new SpeechCompute(
    'auto',
    () => pending.promise,
    vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>(),
  );
  compute.reportUnavailable('runtime_missing');
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  const check = compute.check();
  compute.reportUnavailable('no_hardware');
  expect(compute.state().gpuCheck.phase).toBe('checking');
  pending.resolve({ phase: 'unavailable', reason: 'probe_failed' });
  await check;
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});

it('reports ready only when the verified GPU inference path is enabled', async () => {
  const changed = vi.fn<(value: import('../src/speech_compute_types').SpeechComputeState) => void>();
  const compute = new SpeechCompute('gpu', () => Promise.resolve({ phase: 'ready' }), changed, /* allowReady= */ true);
  await compute.check();
  expect(compute.state().gpuCheck).toEqual({ phase: 'ready' });
});
