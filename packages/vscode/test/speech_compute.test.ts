import { expect, it, vi } from 'vitest';
import { SpeechCompute } from '../src/speech_compute';

it('keeps CPU as the default and reports CPU only when the worker starts', () => {
  const changed = vi.fn();
  const compute = new SpeechCompute('invalid', async () => ({ phase: 'unavailable', reason: 'runtime_missing' }), changed);
  expect(compute.state()).toEqual({ requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  compute.actual('cpu');
  expect(changed).toHaveBeenCalledWith({ requestedMode: 'cpu', actualBackend: 'cpu', gpuCheck: { phase: 'idle' } });
});

it('does not call a verified probe a usable GPU before an inference worker exists', async () => {
  const changed = vi.fn();
  const compute = new SpeechCompute('gpu', async () => ({ phase: 'ready' }), changed);
  await compute.check();
  expect(compute.state()).toEqual({
    requestedMode: 'gpu',
    actualBackend: 'none',
    gpuCheck: { phase: 'unavailable', reason: 'runtime_missing' },
  });
});

it('selects a mode and ignores a second check while the first is running', async () => {
  const deferred = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  const probe = vi.fn(() => deferred.promise);
  const changed = vi.fn();
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
    async () => {
      throw new Error('private details');
    },
    vi.fn(),
  );
  await compute.check();
  expect(compute.state().gpuCheck).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});
