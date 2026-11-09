import { GpuProcessBusyError } from './speech_gpu_slot';
import * as path from 'node:path';
import type { GpuCheck } from './speech_compute_types';
import type { GpuLaunchCapability } from './speech_gpu_client';
import type { TrustedGpuDriver } from './speech_gpu_driver';
import type { TrustedGpuLoader } from './speech_gpu_loader_allowlist';
import type { GpuProbeResult } from './speech_gpu_check';
import { issueGpuCapability, type GpuCapabilityResult } from './speech_gpu_capability';

/** The concrete operations required to verify one GPU runtime and host. */
export interface GpuBindingDependencies {
  supported: boolean;
  runtimeDirectory: string;
  runtimeVerified: () => Promise<boolean>;
  model: () => Promise<string | undefined>;
  loader: () => Promise<TrustedGpuLoader | undefined>;
  driver: () => Promise<TrustedGpuDriver | undefined>;
  physical: (runtime: string, loader: string, driver: TrustedGpuDriver) => Promise<boolean>;
  proof: (capability: GpuLaunchCapability, kind: 'negative' | 'tiny' | 'model') => Promise<GpuProbeResult>;
}

/** Creates fresh preflight and capability checks for a companion runtime. */
export function createGpuBinding(dependencies: GpuBindingDependencies): {
  preflight: () => Promise<GpuCheck>;
  issue: () => Promise<GpuCapabilityResult>;
} {
  async function prepare(): Promise<{ check: GpuCheck; loader?: TrustedGpuLoader; driver?: TrustedGpuDriver }> {
    if (!dependencies.supported) return { check: { phase: 'unavailable', reason: 'unsupported' } };
    try {
      if (!(await dependencies.runtimeVerified())) return { check: { phase: 'unavailable', reason: 'runtime_missing' } };
      const loader = await dependencies.loader();
      const driver = await dependencies.driver();
      if (loader === undefined || driver === undefined) return { check: { phase: 'unavailable', reason: 'untrusted_driver' } };
      if (!(await dependencies.physical(dependencies.runtimeDirectory, loader.path, driver))) {
        return { check: { phase: 'unavailable', reason: 'no_hardware' } };
      }
      return { check: { phase: 'ready' }, loader, driver };
    } catch (error: unknown) {
      return { check: { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : 'inconclusive' } };
    }
  }
  return {
    preflight: async () => (await prepare()).check,
    issue: async () => {
      const prepared = await prepare();
      if (prepared.check.phase !== 'ready' || prepared.loader === undefined || prepared.driver === undefined) {
        return { check: prepared.check };
      }
      let model: string | undefined;
      try {
        model = await dependencies.model();
      } catch {
        return { check: { phase: 'unavailable', reason: 'model_missing' } };
      }
      if (model === undefined) return { check: { phase: 'unavailable', reason: 'model_missing' } };
      const loader = prepared.loader;
      const driver = prepared.driver;
      return issueGpuCapability({
        supported: dependencies.supported,
        runtimeDirectory: dependencies.runtimeDirectory,
        modelDirectory: model,
        executablePath: path.join(dependencies.runtimeDirectory, 'node'),
        loaderPath: loader.path,
        loaderSha256: loader.sha256,
        driverManifest: driver.manifest,
        driverPath: driver.identity.path,
        driverSha256: driver.identity.sha256,
        driverDevice: driver.identity.device,
        driverInode: driver.identity.inode,
        inferenceAvailable: true,
        runtimeAvailable: dependencies.runtimeVerified,
        modelAvailable: async () => (await dependencies.model()) === model,
        probeFor: (capability) => ({
          trust: async () => {
            const next = await dependencies.loader();
            const nextDriver = await dependencies.driver();
            return (
              next?.path === loader.path &&
              next.sha256 === loader.sha256 &&
              nextDriver?.manifest === driver.manifest &&
              nextDriver.identity.path === driver.identity.path &&
              nextDriver.identity.sha256 === driver.identity.sha256 &&
              nextDriver.identity.device === driver.identity.device &&
              nextDriver.identity.inode === driver.identity.inode
            );
          },
          enumerate: () => dependencies.physical(dependencies.runtimeDirectory, loader.path, driver),
          run: (kind) => dependencies.proof(capability, kind),
        }),
      });
    },
  };
}
