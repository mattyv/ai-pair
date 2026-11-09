import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { verifyMappedGpuDriver, verifyNoGpuDriver, type GpuDriverIdentity } from './speech_gpu_driver_identity';
import { verifyMappedVulkanLoader } from './speech_gpu_loader';
import { observedNoAdapter } from './speech_gpu_negative';
import { gpuSessionOptions } from './speech_gpu_options';
import { runGpuSelfTest } from './speech_gpu_selftest';
import { runGpuTiny } from './speech_gpu_tiny';
import type { GpuProbeResult } from './speech_gpu_check';

/** Inputs to one fresh proof child. */
export interface GpuProofWorkerOptions {
  graph: string;
  model: string;
  profilePrefix: string;
  loaderPath: string;
  loaderSha256: string;
  driver: GpuDriverIdentity;
}

const MAX_PROFILE_BYTES = 33_554_432;
// The tiny graph has a fixed six-element input and a three-by-two shape.
// oxlint-disable-next-line eslint/no-magic-numbers
const TINY_INPUT = [1, 2, 3, 4, 5, 6];
// oxlint-disable-next-line eslint/no-magic-numbers
const TINY_SHAPE = [3, 2];
const ARGUMENT_COUNT = 12;

/** Reads only one bounded profile in the child's private directory. */
async function readProfile(prefix: string): Promise<unknown> {
  const dir = path.dirname(prefix);
  const name = path.basename(prefix);
  const files = (await fs.readdir(dir)).filter((file) => file.startsWith(name) && file.endsWith('.json'));
  if (files.length !== 1 || files[0] === undefined) throw new Error('GPU profile unavailable.');
  const file = path.join(dir, files[0]);
  const info = await fs.stat(file);
  if (!info.isFile() || info.size > MAX_PROFILE_BYTES) throw new Error('GPU profile unavailable.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Rejects anything other than the fixed tensors made inside this child. */
function tensorFeeds(feeds: Record<string, unknown>): Record<string, Tensor> {
  return Object.fromEntries(
    Object.entries(feeds).map(([name, value]) => {
      if (!(value instanceof Tensor)) throw new Error('Invalid proof tensor.');
      return [name, value];
    }),
  );
}

/** Runs one fixed proof with the same forced-Vulkan provider as narration. */
export async function runGpuProofWorker(kind: 'negative' | 'tiny' | 'model', options: GpuProofWorkerOptions): Promise<GpuProbeResult> {
  async function loader(): Promise<boolean> {
    return (await verifyMappedVulkanLoader(options.loaderPath, options.loaderSha256)) &&
      (kind === 'negative' ? await verifyNoGpuDriver(options.loaderPath) : await verifyMappedGpuDriver(options.driver, options.loaderPath));
  }
  if (kind === 'negative') {
    let session: InferenceSession;
    try {
      session = await InferenceSession.create(options.graph, gpuSessionOptions(true));
    } catch (error: unknown) {
      return observedNoAdapter(error, await loader()) ? 'rejected' : 'failed';
    }
    try {
      await session.release();
    } catch {
      // A cleanup failure cannot prove that the adapter was absent.
    }
    return 'failed';
  }
  if (kind === 'tiny') {
    const passed = await runGpuTiny(options.graph, {
      create: async (graph) => {
        const session = await InferenceSession.create(graph, gpuSessionOptions(true));
        return { run: (feeds) => session.run(tensorFeeds(feeds)), release: () => session.release() };
      },
      tensor: () => new Tensor('float32', Float32Array.from(TINY_INPUT), TINY_SHAPE),
      loader,
    });
    return passed ? 'passed' : 'failed';
  }
  const passed = await runGpuSelfTest(options.model, options.profilePrefix, {
    create: async (model, prefix) => {
      const session = await InferenceSession.create(model, {
        ...gpuSessionOptions(false),
        enableProfiling: true,
        profileFilePrefix: prefix,
      });
      return {
        run: (feeds) => session.run(tensorFeeds(feeds)),
        release: () => session.release(),
        endProfiling: () => {
          session.endProfiling();
        },
      };
    },
    tensor: (type, values, shape) => {
      if (type === 'int64' && values instanceof BigInt64Array) return new Tensor('int64', values, shape);
      if (type === 'float32' && values instanceof Float32Array) return new Tensor('float32', values, shape);
      throw new Error('Invalid proof tensor.');
    },
    loader,
    profile: () => readProfile(options.profilePrefix),
  });
  return passed ? 'passed' : 'failed';
}

if (process.argv[2] === '--ai-pair-gpu-proof') {
  const [, , , kind, graph, model, profilePrefix, loaderPath, loaderSha256, driverPath, driverSha256, driverDevice, driverInode] = process.argv;
  if (
    process.argv.length !== ARGUMENT_COUNT + 1 ||
    (kind !== 'negative' && kind !== 'tiny' && kind !== 'model') ||
    graph === undefined ||
    model === undefined ||
    profilePrefix === undefined ||
    loaderPath === undefined ||
    loaderSha256 === undefined ||
    driverPath === undefined || driverSha256 === undefined || driverDevice === undefined || driverInode === undefined ||
    ![graph, model, profilePrefix, loaderPath, driverPath].every((value) => path.isAbsolute(value)) ||
    !/^[a-f0-9]{64}$/.test(loaderSha256) || !/^[a-f0-9]{64}$/.test(driverSha256) ||
    !/^[0-9]+$/.test(driverDevice) || !/^[0-9]+$/.test(driverInode)
  ) {
    process.exit(1);
  } else {
    void runGpuProofWorker(kind, { graph, model, profilePrefix, loaderPath, loaderSha256, driver: { path: driverPath, sha256: driverSha256, device: driverDevice, inode: driverInode } }).then(
      (result) => {
        if (process.send === undefined || !process.connected) return;
        process.send({ type: 'gpu-proof', kind, result }, () => {
          if (process.connected) process.disconnect();
        });
      },
      () => {
        if (process.send === undefined || !process.connected) return;
        process.send({ type: 'gpu-proof', kind, result: 'failed' }, () => {
          if (process.connected) process.disconnect();
        });
      },
    );
  }
}
