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
  physical: (runtime: string, loader: string, driver: TrustedGpuDriver, signal?: AbortSignal) => Promise<boolean>;
  proof: (capability: GpuLaunchCapability, kind: 'negative' | 'tiny' | 'model', signal?: AbortSignal) => Promise<GpuProbeResult>;
}

/** Creates fresh preflight and capability checks for a companion runtime. */
export function createGpuBinding(dependencies: GpuBindingDependencies): {
  preflight: (signal?: AbortSignal) => Promise<GpuCheck>;
  issue: (signal?: AbortSignal) => Promise<GpuCapabilityResult>;
} {
  async function prepare(signal?: AbortSignal): Promise<{ check: GpuCheck; loader?: TrustedGpuLoader; driver?: TrustedGpuDriver }> {
    function checkAbort(): void {
      if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
    }
    checkAbort();
    if (!dependencies.supported) return { check: { phase: 'unavailable', reason: 'unsupported' } };
    try {
      const runtimeReady = await dependencies.runtimeVerified();
      checkAbort();
      if (!runtimeReady) return { check: { phase: 'unavailable', reason: 'runtime_missing' } };
      const loader = await dependencies.loader();
      checkAbort();
      const driver = await dependencies.driver();
      checkAbort();
      if (loader === undefined || driver === undefined) return { check: { phase: 'unavailable', reason: 'untrusted_driver' } };
      const physical = await dependencies.physical(dependencies.runtimeDirectory, loader.path, driver, signal);
      checkAbort();
      if (!physical) {
        return { check: { phase: 'unavailable', reason: 'no_hardware' } };
      }
      checkAbort();
      return { check: { phase: 'ready' }, loader, driver };
    } catch (error: unknown) {
      checkAbort();
      return { check: { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : 'inconclusive' } };
    }
  }
  return {
    preflight: async (signal) => (await prepare(signal)).check,
    issue: async (signal) => {
      function checkAbort(): void {
        if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
      }
      const prepared = await prepare(signal);
      checkAbort();
      if (prepared.check.phase !== 'ready' || prepared.loader === undefined || prepared.driver === undefined) {
        return { check: prepared.check };
      }
      let model: string | undefined;
      try {
        model = await dependencies.model();
      } catch {
        checkAbort();
        return { check: { phase: 'unavailable', reason: 'model_missing' } };
      }
      checkAbort();
      if (model === undefined) return { check: { phase: 'unavailable', reason: 'model_missing' } };
      const loader = prepared.loader;
      const driver = prepared.driver;
      return issueGpuCapability(
        {
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
              checkAbort();
              const next = await dependencies.loader();
              checkAbort();
              const nextDriver = await dependencies.driver();
              checkAbort();
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
            enumerate: async () => {
              checkAbort();
              const result = await dependencies.physical(dependencies.runtimeDirectory, loader.path, driver, signal);
              checkAbort();
              return result;
            },
            run: async (kind) => {
              checkAbort();
              const result = await dependencies.proof(capability, kind, signal);
              checkAbort();
              return result;
            },
          }),
        },
        signal,
      );
    },
  };
}
