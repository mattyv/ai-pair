import * as path from 'node:path';
import type { GpuDriverIdentity } from './speech_gpu_driver_identity';
import { LOCAL_PROTOCOL_VERSION, type LocalResponse } from './speech_local_protocol';
import type { SpeechTokens } from './speech_synthesis';
import { loadVerifiedGpuSpeechEngine } from './speech_gpu_verified_engine';
import { GpuWorkerHost, type DisposableGpuEngine } from './speech_gpu_worker_host';

const GPU_ARGUMENT_COUNT = 7;

/** The IPC operations exposed to the isolated process bootstrap. */
export interface GpuWorkerChannel {
  on(event: 'message' | 'disconnect', listener: (value: unknown) => void): void;
  send(message: LocalResponse): void;
  close(): void;
}

/** Attaches a verified GPU worker to its parent channel. */
export function attachGpuWorker<T extends SpeechTokens>(
  channel: GpuWorkerChannel,
  args: readonly string[],
  dependencies: {
    load(path: string): Promise<DisposableGpuEngine<T>>;
    verify(path: string, sha256: string): Promise<boolean>;
    verifyDriver(identity: GpuDriverIdentity, loaderPath: string): Promise<boolean>;
  },
): void {
  const [loaderPath, loaderSha256, verifiedModel, driverPath, driverSha256, driverDevice, driverInode] = args;
  if (
    args.length !== GPU_ARGUMENT_COUNT ||
    verifiedModel === undefined ||
    !path.isAbsolute(verifiedModel) ||
    loaderPath === undefined ||
    !path.isAbsolute(loaderPath) ||
    loaderSha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(loaderSha256) ||
    driverPath === undefined ||
    !path.isAbsolute(driverPath) ||
    driverSha256 === undefined ||
    !/^[a-f0-9]{64}$/.test(driverSha256) ||
    driverDevice === undefined ||
    !/^[0-9]+$/.test(driverDevice) ||
    driverInode === undefined ||
    !/^[0-9]+$/.test(driverInode)
  ) {
    throw new Error('Invalid GPU loader identity.');
  }
  let loaderCompromised = false;
  const host = new GpuWorkerHost(
    (modelPath) => {
      if (modelPath !== verifiedModel) throw new Error('GPU model does not match launch.');
      return loadVerifiedGpuSpeechEngine(
        modelPath,
        { path: loaderPath, sha256: loaderSha256 },
        {
          ...dependencies,
          verify: async (loader, digest) =>
            (await dependencies.verify(loader, digest)) &&
            (await dependencies.verifyDriver(
              { path: driverPath, sha256: driverSha256, device: driverDevice, inode: driverInode },
              loaderPath,
            )),
          proofFailed: () => {
            loaderCompromised = true;
          },
        },
      );
    },
    (message) => {
      if (loaderCompromised && message.type === 'failure' && message.category === 'synthesis') {
        channel.send({ ...message, category: 'protocol' });
      } else {
        channel.send(message);
      }
    },
    () => {
      channel.close();
    },
  );
  channel.on('message', (message) => {
    void host.receive(message).catch(() => {
      channel.close();
    });
  });
  channel.on('disconnect', () => {
    void host.receive({ type: 'shutdown', version: LOCAL_PROTOCOL_VERSION }).catch(() => {
      channel.close();
    });
  });
}
