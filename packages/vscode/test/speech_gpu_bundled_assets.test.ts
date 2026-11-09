import { afterEach, expect, it, vi } from 'vitest';
import { bundledGpuAssets } from '../src/speech_gpu_bundled_assets';

afterEach(() => {
  vi.unstubAllGlobals();
});
it('returns no trusted assets outside a bundle and the embedded build manifest when present', () => {
  expect(bundledGpuAssets()).toEqual([]);
  const assets = [{ path: 'gpu_worker.mjs', size: 1, sha256: 'a'.repeat(64) }];
  vi.stubGlobal('AI_PAIR_GPU_ASSETS', assets);
  expect(bundledGpuAssets()).toEqual(assets);
});
