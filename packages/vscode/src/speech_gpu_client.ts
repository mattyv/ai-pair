import { fork } from 'node:child_process';
import * as path from 'node:path';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisPort } from './speech_local_client';
import { GpuProcessTransport, type GpuChildProcess } from './speech_gpu_transport';
import { LOCAL_REQUEST } from './speech_local_protocol';

/** A fresh, externally verified launch capability; it contains no credentials. */
export interface GpuLaunchCapability {
  readonly runtimeDirectory: string;
  readonly modelDirectory: string;
  readonly executablePath: string;
  readonly loaderPath: string;
  readonly loaderSha256: string;
  readonly environment: Readonly<{ LANG: 'C'; VK_DRIVER_FILES: string; VK_LOADER_LAYERS_DISABLE: '~all~' }>;
}

/** Constructs an isolated GPU worker client for one verified capability. */
export function createGpuSynthesisClient(options: { listener: LocalListener; capability: GpuLaunchCapability }): LocalSynthesisPort {
  const { runtimeDirectory, modelDirectory, executablePath, loaderPath, loaderSha256, environment } = options.capability;
  if (
    ![runtimeDirectory, modelDirectory, executablePath, loaderPath, environment.VK_DRIVER_FILES].every((value) => path.isAbsolute(value)) ||
    !/^[a-f0-9]{64}$/.test(loaderSha256)
  ) {
    throw new Error('GPU runtime paths must be absolute.');
  }
  const env = {
    LANG: 'C',
    VK_DRIVER_FILES: environment.VK_DRIVER_FILES,
    VK_LOADER_LAYERS_DISABLE: '~all~',
    ELECTRON_RUN_AS_NODE: '1',
  };
  const local = new LocalSynthesisClient({
    listener: options.listener,
    spawn: (modelPath) => {
      if (modelPath !== modelDirectory) throw new Error('GPU model does not match verified capability.');
      const child = fork(path.join(runtimeDirectory, 'gpu_worker.mjs'), [loaderPath, loaderSha256, modelDirectory], {
        execPath: executablePath,
        execArgv: [],
        env,
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
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
