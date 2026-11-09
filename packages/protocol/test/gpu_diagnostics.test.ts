import { expect, it } from 'vitest';
import { gpuDiagnostics } from '../src/gpu_diagnostics';

it('accepts only bounded fixed GPU diagnostic facts', () => {
  const snapshot = {
    requestedMode: 'gpu',
    actualBackend: 'none',
    check: { phase: 'unavailable', reason: 'no_hardware' },
    stage: 'preflight',
    workerDetails: ['spawn_error', 'exit_nonzero'],
  };
  expect(gpuDiagnostics.safeParse(snapshot).success).toBe(true);
  expect(gpuDiagnostics.safeParse({ ...snapshot, path: '/private' }).success).toBe(false);
  expect(gpuDiagnostics.safeParse({ ...snapshot, workerDetails: Array.from({ length: 9 }, () => 'exit_nonzero') }).success).toBe(false);
  expect(gpuDiagnostics.safeParse({ ...snapshot, workerDetails: ['private error'] }).success).toBe(false);
});
