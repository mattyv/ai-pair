import { gpuEnvironment } from './speech_gpu_environment';
import { fork } from 'node:child_process';
import * as path from 'node:path';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisPort } from './speech_local_client';
import { GpuProcessTransport, type GpuChildProcess } from './speech_gpu_transport';
import { LOCAL_REQUEST } from './speech_local_protocol';
import { GpuProcessBusyError, tryAcquireGpuProcessSlot } from './speech_gpu_slot';
export { GpuProcessBusyError } from './speech_gpu_slot';

/** A fresh, externally verified launch capability; it contains no credentials. */
export interface GpuLaunchCapability {
  readonly runtimeDirectory: string;
  readonly modelDirectory: string;
  readonly executablePath: string;
  readonly loaderPath: string;
  readonly loaderSha256: string;
  readonly driverPath: string;
  readonly driverSha256: string;
  readonly driverDevice: string;
  readonly driverInode: string;
  readonly environment: Readonly<{ LANG: 'C'; VK_DRIVER_FILES: string; VK_LOADER_LAYERS_DISABLE: '~all~'; LD_PRELOAD: string }>;
}

/** Constructs an isolated GPU worker client for one verified capability. */
export function createGpuSynthesisClient(options: { listener: LocalListener; capability: GpuLaunchCapability }): LocalSynthesisPort {
  const { runtimeDirectory, modelDirectory, executablePath, loaderPath, loaderSha256, driverPath, driverSha256, driverDevice, driverInode, environment } = options.capability;
  if (
    ![runtimeDirectory, modelDirectory, executablePath, loaderPath, driverPath, environment.VK_DRIVER_FILES].every((value) => path.isAbsolute(value)) ||
    !/^[a-f0-9]{64}$/.test(loaderSha256) || !/^[a-f0-9]{64}$/.test(driverSha256) ||
    !/^[0-9]+$/.test(driverDevice) || !/^[0-9]+$/.test(driverInode) || environment.LD_PRELOAD !== loaderPath
  ) {
    throw new Error('GPU runtime paths must be absolute.');
  }
  const env = {
    ...gpuEnvironment(environment.VK_DRIVER_FILES, loaderPath),
    ELECTRON_RUN_AS_NODE: '1',
  };
  const local = new LocalSynthesisClient({
    listener: options.listener,
    spawn: (modelPath) => {
      if (modelPath !== modelDirectory) throw new Error('GPU model does not match verified capability.');
      const release = tryAcquireGpuProcessSlot();
      if (release === undefined) throw new GpuProcessBusyError();
      let child: ReturnType<typeof fork>;
      try {
        child = fork(path.join(runtimeDirectory, 'gpu_worker.mjs'), [loaderPath, loaderSha256, modelDirectory, driverPath, driverSha256, driverDevice, driverInode], {
          execPath: executablePath,
          execArgv: [],
          env,
          serialization: 'advanced',
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
      } catch (error: unknown) {
        release();
        throw error;
      }
      child.on('close', release);
      const adapter: GpuChildProcess = {
        send: (message, callback) => {
          child.send(LOCAL_REQUEST.parse(message), callback);
        },
        kill: (signal) => child.kill(signal),
        on: (event, listener) => {
          if (event === 'message') child.on('message', listener);
          else if (event === 'error') child.on('error', listener);
          else child.on('close', listener);
        },
      };
      return new GpuProcessTransport(adapter);
    },
  });
  return {
    state: () => local.state(),
    busy: () => local.busy(),
    load: (modelPath) => {
      if (modelPath !== modelDirectory) throw new Error('GPU model does not match verified capability.');
      local.load(modelPath);
    },
    synthesize: (request) => local.synthesize(request),
    cancel: () => {
      if (!local.busy() && local.state() !== 'loading') return;
      local.cancel();
      local.retire('worker_exit');
    },
    retire: (reason) => {
      local.retire(reason);
    },
  };
}
