import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { gpuEnvironment } from './speech_gpu_environment';
import { runGpuProcess, type GpuChild } from './speech_gpu_process';
import type { TrustedGpuDriver } from './speech_gpu_driver';
import { withGpuProcessSlot } from './speech_gpu_proof_runner';

const PHYSICAL_PROBE_TIMEOUT_MS = 10_000;

/** Runs the bounded native physical AMD check in the isolated Vulkan environment. */
export async function gpuPhysicalDevice(
  runtimeDirectory: string,
  loaderPath: string,
  driver: TrustedGpuDriver,
  signal?: AbortSignal,
): Promise<boolean> {
  const outcome = await withGpuProcessSlot(() =>
    runGpuProcess(
      () => {
        const child = spawn(
          path.join(runtimeDirectory, 'gpu_probe'),
          [loaderPath, driver.identity.path, driver.identity.device, driver.identity.inode],
          { env: gpuEnvironment(driver.manifest, loaderPath), stdio: 'ignore' },
        );
        const wrapper: GpuChild = {
          on: (event, listener) => {
            if (event === 'error') child.on('error', listener);
            else child.on('close', listener);
          },
          kill: (killSignal) => child.kill(killSignal),
        };
        return wrapper;
      },
      PHYSICAL_PROBE_TIMEOUT_MS,
      signal,
    ),
  );
  return outcome === 'passed';
}
