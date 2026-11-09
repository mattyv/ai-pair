import { gpuEnvironment } from './speech_gpu_environment';
import { fork } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GpuLaunchCapability } from './speech_gpu_client';
import type { GpuProbeResult } from './speech_gpu_check';

/** Maximum time allowed to load and test the model in one proof child. */
const PROOF_TIMEOUT_MS = 120_000;
const RESULT_FIELD_COUNT = 3;

export { withGpuProcessSlot } from './speech_gpu_slot';
import { withGpuProcessSlot } from './speech_gpu_slot';

/** Starts each proof in a fresh child and waits for its close before returning. */
export function createGpuProofRunner(capability: GpuLaunchCapability): (kind: 'negative' | 'tiny' | 'model') => Promise<GpuProbeResult> {
  return (kind) =>
    withGpuProcessSlot(async () => {
      let directory: string;
      try {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-gpu-proof-'));
      } catch {
        return 'failed';
      }
      try {
        const env = {
          ...gpuEnvironment(kind === 'negative' ? path.join(directory, 'nonexistent-icd.json') : capability.environment.VK_DRIVER_FILES, capability.loaderPath),
          ELECTRON_RUN_AS_NODE: '1',
        };
        const args = [
          '--ai-pair-gpu-proof',
          kind,
          path.join(capability.runtimeDirectory, 'gpu_probe.onnx'),
          path.join(capability.modelDirectory, 'onnx', 'model.onnx'),
          path.join(directory, 'profile'),
          capability.loaderPath,
          capability.loaderSha256,
          capability.driverPath, capability.driverSha256, capability.driverDevice, capability.driverInode,
        ];
        return await new Promise<GpuProbeResult>((resolve) => {
          let child: ReturnType<typeof fork>;
          try {
            child = fork(path.join(capability.runtimeDirectory, 'gpu_proof_worker.mjs'), args, {
              execPath: capability.executablePath,
              execArgv: [],
              env,
              serialization: 'advanced',
              stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            });
          } catch {
            resolve('failed');
            return;
          }
          let timedOut = false;
          let failed = false;
          let reported: GpuProbeResult | undefined;
          function stop(): void {
            try {
              child.kill('SIGKILL');
            } catch {
              /* Keep ownership until close. */
            }
          }
          const timer = setTimeout(() => {
            timedOut = true;
            stop();
          }, PROOF_TIMEOUT_MS);
          child.on('error', () => {
            failed = true;
          });
          child.on('message', (value: unknown) => {
            if (
              reported !== undefined ||
              typeof value !== 'object' ||
              value === null ||
              Object.keys(value).length !== RESULT_FIELD_COUNT ||
              !('type' in value) ||
              value.type !== 'gpu-proof' ||
              !('kind' in value) ||
              value.kind !== kind ||
              !('result' in value) ||
              (value.result !== 'passed' && value.result !== 'rejected' && value.result !== 'failed')
            ) {
              failed = true;
            } else {
              reported = value.result;
            }
            stop();
          });
          child.on('close', () => {
            clearTimeout(timer);
            if (timedOut) resolve('timeout');
            else if (failed || reported === undefined) resolve('failed');
            else if (kind === 'negative' && reported === 'rejected') resolve('rejected');
            else if (kind !== 'negative' && reported === 'passed') resolve('passed');
            else resolve('failed');
          });
        });
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    });
}
