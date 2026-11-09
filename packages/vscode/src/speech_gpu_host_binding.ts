import * as path from 'node:path';
import { createGpuBinding, type GpuBindingDependencies } from './speech_gpu_binding';
import { bundledGpuAssets } from './speech_gpu_bundled_assets';
import { verifyGpuAssets } from './speech_gpu_assets';
import { gpuAssetFilesystem } from './speech_gpu_asset_fs';
import { installedGpuModel } from './speech_gpu_model';
import { systemGpuDriver, systemGpuLoader } from './speech_gpu_system';
import { gpuPhysicalDevice } from './speech_gpu_physical';

/** Binds the companion's packaged assets and real system checks to fresh GPU proof. */
export function createGpuHostBinding(options: {
  extensionPath: string;
  storageDirectory: string;
  platform: string;
  arch: string;
  proof: GpuBindingDependencies['proof'];
}): ReturnType<typeof createGpuBinding> {
  const runtimeDirectory = path.join(options.extensionPath, 'dist', 'speech-gpu');
  return createGpuBinding({
    supported: options.platform === 'linux' && options.arch === 'x64',
    runtimeDirectory,
    runtimeVerified: () => verifyGpuAssets(runtimeDirectory, bundledGpuAssets(), gpuAssetFilesystem),
    model: () => installedGpuModel(options.storageDirectory),
    loader: systemGpuLoader,
    driver: systemGpuDriver,
    physical: gpuPhysicalDevice,
    proof: options.proof,
  });
}
