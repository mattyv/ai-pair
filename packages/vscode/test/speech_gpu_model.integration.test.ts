import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { installedGpuModel, setupGpuModel } from '../src/speech_gpu_model';

const fake = vi.hoisted(() => ({ cpu: '' }));
vi.mock('../src/speech_model_manifest', () => ({
  MODEL_REVISION: 'revision',
  MODEL_URL: 'https://huggingface.co/fixed',
  MODEL_ASSETS: [{ path: 'tokenizer.json', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }],
}));
vi.mock('../src/speech_gpu_model_manifest', () => ({
  GPU_MODEL_ASSET: { path: 'onnx/model.onnx', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
}));
vi.mock('../src/speech_setup', () => ({ installedSpeechModel: () => Promise.resolve(fake.cpu) }));
let directory = '';
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory !== '') await fs.rm(directory, { recursive: true, force: true });
  directory = '';
});

it('installs a separately verified GPU directory without changing the CPU assets', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-gpu-model-'));
  fake.cpu = path.join(directory, 'speech', 'revision');
  await fs.mkdir(fake.cpu, { recursive: true });
  await fs.writeFile(path.join(fake.cpu, 'tokenizer.json'), 'abc');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a'));
      controller.enqueue(new TextEncoder().encode('bc'));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  const progress: number[] = [];
  const gpu = await setupGpuModel(directory, {
    signal: new AbortController().signal,
    progress: (bytes) => {
      progress.push(bytes);
    },
  });
  expect(progress).toEqual([1, 2]);
  expect(gpu).toBe(path.join(directory, 'speech-gpu', 'revision'));
  expect(await installedGpuModel(directory)).toBe(gpu);
  expect(await fs.readFile(path.join(gpu, 'onnx', 'model.onnx'), 'utf8')).toBe('abc');
  expect(await fs.readFile(path.join(fake.cpu, 'tokenizer.json'), 'utf8')).toBe('abc');
  await fs.writeFile(path.join(gpu, 'tokenizer.json'), 'bad');
  expect(await installedGpuModel(directory)).toBeUndefined();
});

it('runs physical preflight before downloading a model and reports byte progress through the real setup flow', async () => {
  const { preflightGpu } = await import('../src/speech_gpu_preflight');
  const { setupGpuFlow } = await import('../src/speech_gpu_setup_flow');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-gpu-flow-'));
  fake.cpu = path.join(directory, 'speech', 'revision');
  await fs.mkdir(fake.cpu, { recursive: true });
  await fs.writeFile(path.join(fake.cpu, 'tokenizer.json'), 'abc');
  const fetcher = vi.fn(() => Promise.resolve(new Response('abc')));
  vi.stubGlobal('fetch', fetcher);
  const hardware = vi.fn().mockResolvedValue(false);
  const progress = vi.fn<(value: import('../src/speech_compute_types').GpuCheckProgress) => void>();
  function run(): Promise<import('../src/speech_compute_types').GpuCheck> {
    return setupGpuFlow({
      preflight: () =>
        preflightGpu({
          supported: true,
          runtimeAvailable: () => Promise.resolve(true),
          trust: () => Promise.resolve(true),
          enumerate: hardware,
        }),
      cpuModel: () => Promise.resolve(fake.cpu),
      gpuModel: () => installedGpuModel(directory),
      download: (report) => setupGpuModel(directory, { signal: new AbortController().signal, progress: report }),
      verify: () => Promise.resolve({ phase: 'unavailable', reason: 'probe_failed' }),
      signal: new AbortController().signal,
      progress,
    });
  }
  expect(await run()).toEqual({ phase: 'unavailable', reason: 'no_hardware' });
  expect(fetcher).not.toHaveBeenCalled();
  hardware.mockResolvedValue(true);
  expect(await run()).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(progress).toHaveBeenCalledWith({ stage: 'download', current: 3, total: 3 });
});
