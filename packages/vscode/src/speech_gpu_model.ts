import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MODEL_ASSETS, MODEL_REVISION, MODEL_URL } from './speech_model_manifest';
import { GPU_MODEL_ASSET } from './speech_gpu_model_manifest';
import { GpuModelTimeoutError } from './speech_gpu_model_error';
import { installedSpeechModel } from './speech_setup';

const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 900_000;
// HTTP redirect statuses are protocol-defined.
// eslint-disable-next-line no-magic-numbers
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Follows only HTTPS redirects to approved Hugging Face download hosts. */
async function responseForModel(signal: AbortSignal): Promise<Response> {
  let current = new URL(`${MODEL_URL}/${GPU_MODEL_ASSET.path}`);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.username !== '' ||
      current.password !== '' ||
      current.port !== '' ||
      !(current.hostname === 'huggingface.co' || current.hostname.endsWith('.huggingface.co') || current.hostname.endsWith('.hf.co'))
    ) {
      throw new Error('Unsupported GPU model download host.');
    }
    const response = await fetch(current, { signal, redirect: 'manual' });
    if (!REDIRECTS.has(response.status)) return response;
    const location = response.headers.get('location');
    if (location === null) throw new Error('Invalid GPU model redirect.');
    current = new URL(location, current);
  }
  throw new Error('Too many GPU model redirects.');
}

/** Verifies the separate FP32 file without trusting its filename or size alone. */
async function verified(file: string, asset: { size: number; sha256: string }): Promise<boolean> {
  try {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size !== asset.size) return false;
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > asset.size) return false;
      hash.update(chunk);
    }
    return size === asset.size && hash.digest('hex') === asset.sha256;
  } catch {
    return false;
  }
}

/** Returns the separate GPU directory only after every required asset verifies. */
export async function installedGpuModel(storageDirectory: string): Promise<string | undefined> {
  const directory = path.join(storageDirectory, 'speech-gpu', MODEL_REVISION);
  for (const asset of [...MODEL_ASSETS.filter((item) => item.path !== 'onnx/model_quantized.onnx'), GPU_MODEL_ASSET]) {
    if (!(await verified(path.join(directory, asset.path), asset))) return undefined;
  }
  return directory;
}

/** Identifies an absent target without hiding other filesystem errors. */
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Downloads and atomically installs a separate GPU model using verified shared assets. */
export async function setupGpuModel(
  storageDirectory: string,
  options: { signal: AbortSignal; progress: (bytes: number) => void },
): Promise<string> {
  const existing = await installedGpuModel(storageDirectory);
  if (existing !== undefined) return existing;
  const base = await installedSpeechModel(storageDirectory);
  if (base === undefined || options.signal.aborted) throw new Error('GPU model setup is unavailable.');
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timeout]);
  const root = path.join(storageDirectory, 'speech-gpu');
  const target = path.join(root, MODEL_REVISION);
  await fs.mkdir(root, { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, '.gpu-'));
  const staged = path.join(staging, GPU_MODEL_ASSET.path);
  let backup: string | undefined;
  let committed = false;
  try {
    for (const asset of MODEL_ASSETS) {
      if (asset.path === 'onnx/model_quantized.onnx') continue;
      if (signal.aborted) throw new Error('GPU model setup cancelled.');
      const destination = path.join(staging, asset.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(base, asset.path), destination);
      if (!(await verified(destination, asset))) throw new Error('GPU model verification failed.');
    }
    await fs.mkdir(path.dirname(staged), { recursive: true });
    const response = await responseForModel(signal);
    if (!response.ok || response.body === null) throw new Error('GPU model download failed.');
    const handle = await fs.open(staged, 'wx');
    const hash = createHash('sha256');
    let size = 0;
    let complete = false;
    try {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      try {
        for (;;) {
          if (signal.aborted) throw new Error('GPU model setup cancelled.');
          const next = await reader.read();
          if (next.done) {
            complete = true;
            break;
          }
          size += next.value.byteLength;
          if (size > GPU_MODEL_ASSET.size) throw new Error('GPU model verification failed.');
          hash.update(next.value);
          await handle.writeFile(next.value);
          options.progress(next.value.byteLength);
        }
      } finally {
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } finally {
      await handle.close();
    }
    if (size !== GPU_MODEL_ASSET.size || hash.digest('hex') !== GPU_MODEL_ASSET.sha256 || signal.aborted) {
      throw new Error('GPU model verification failed.');
    }
    // specs/SpeechSetup.tla, Verify and Commit: only verified bytes become visible.
    if ((await installedGpuModel(storageDirectory)) !== undefined) return target;
    if (signal.aborted) throw new Error('GPU model setup cancelled.');
    backup = `${staging}.old`;
    try {
      await fs.rename(target, backup);
    } catch (error) {
      if (!missing(error)) throw error;
      backup = undefined;
    }
    try {
      if (signal.aborted) throw new Error('GPU model setup cancelled.');
      await fs.rename(staging, target);
      committed = true;
    } catch (error) {
      if (backup !== undefined) {
        await fs.rename(backup, target);
        backup = undefined;
      }
      throw error;
    }
    return target;
  } catch (error) {
    if (timeout.aborted && !options.signal.aborted) throw new GpuModelTimeoutError();
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    if (backup !== undefined && committed) await fs.rm(backup, { recursive: true, force: true });
  }
}
