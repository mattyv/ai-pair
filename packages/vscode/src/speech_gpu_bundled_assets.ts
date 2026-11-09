import type { GpuAsset } from './speech_gpu_assets';

declare const AI_PAIR_GPU_ASSETS: readonly GpuAsset[] | undefined;

/** Returns the build-embedded GPU asset manifest, or no assets outside a bundle. */
export function bundledGpuAssets(): readonly GpuAsset[] {
  return typeof AI_PAIR_GPU_ASSETS === 'undefined' ? [] : AI_PAIR_GPU_ASSETS;
}
