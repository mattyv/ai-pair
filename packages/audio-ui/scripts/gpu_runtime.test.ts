import { expect, it, vi } from 'vitest';
import { stageGpuRuntime } from './gpu_runtime.mts';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  copy: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  build: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:fs', () => ({ mkdirSync: mocks.mkdir, cpSync: mocks.copy, writeFileSync: mocks.write, readFileSync: mocks.read }));
vi.mock('esbuild', () => ({ build: mocks.build }));

it('stages a separate GPU-only runtime and bundles the GPU child entry', async () => {
  mocks.read.mockImplementation((file: string) => {
    const versions = new Map([
      ['kokoro-js', '1.2.1'],
      ['@huggingface/transformers', '4.2.0'],
      ['onnxruntime-node', '1.24.3'],
      ['onnxruntime-common', '1.24.3'],
    ]);
    for (const [name, version] of versions) if (file.endsWith(`${name}/package.json`)) return JSON.stringify({ version });
    throw new Error('unexpected');
  });
  await stageGpuRuntime({
    platform: 'linux',
    arch: 'x64',
    source: '/modules',
    nodeDirectory: '/node',
    destination: '/out',
    digest: (file) =>
      file.endsWith('gpu_probe.onnx')
        ? '71f431c4e9321ec6fbeb158d02ed240459a7dcc98673fa79a4f439ce42efaf10'
        : file.endsWith('/node')
          ? '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90'
          : 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4',
  });
  expect(mocks.copy).toHaveBeenCalledWith('/node/bin/node', '/out/node', { recursive: true });
  expect(mocks.copy).toHaveBeenCalledWith('../vscode/native/gpu_probe.onnx', '/out/gpu_probe.onnx', { recursive: true });
  expect(mocks.copy).toHaveBeenCalledWith(
    '/modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1',
    '/out/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1',
    { recursive: true },
  );
  expect(mocks.build).toHaveBeenCalledWith(
    expect.objectContaining({ entryPoints: ['../vscode/src/speech_gpu_proof_worker.ts'], outfile: '/out/gpu_proof_worker.mjs' }),
  );
  expect(mocks.build).toHaveBeenCalledWith(
    expect.objectContaining({
      entryPoints: ['../vscode/src/speech_gpu_worker.ts'],
      outfile: '/out/gpu_worker.mjs',
      external: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
    }),
  );
});

it('rejects an unexpected runtime version and skips unsupported platforms', async () => {
  mocks.read.mockReturnValue(JSON.stringify({ version: 'unexpected' }));
  await expect(
    stageGpuRuntime({
      platform: 'linux',
      arch: 'x64',
      source: '/modules',
      nodeDirectory: '/node',
      destination: '/out',
      digest: (file) =>
        file.endsWith('/node')
          ? '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90'
          : 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4',
    }),
  ).rejects.toThrow();
  mocks.build.mockClear();
  await stageGpuRuntime({
    platform: 'darwin',
    arch: 'arm64',
    source: '/modules',
    nodeDirectory: '/node',
    destination: '/out',
    digest: (file) =>
      file.endsWith('/node')
        ? '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90'
        : 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4',
  });
  expect(mocks.build).not.toHaveBeenCalled();
});
