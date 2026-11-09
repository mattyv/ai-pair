import { expect, it, vi } from 'vitest';
import { runGpuSelfTest, type GpuSelfTestDependencies } from '../src/speech_gpu_selftest';

function dependencies(): GpuSelfTestDependencies {
  return {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({ waveform: { data: new Float32Array(2400) } }),
      endProfiling: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    }),
    tensor: vi.fn().mockReturnValue({}),
    loader: vi.fn().mockResolvedValue(true),
    profile: vi.fn().mockResolvedValue([{ cat: 'Node', dur: 2, args: { provider: 'WebGpuExecutionProvider', op_name: 'MatMul' } }]),
  };
}
it('requires mapped loader, finite audio across input lengths and actual GPU work', async () => {
  const deps = dependencies();
  expect(await runGpuSelfTest('/model.onnx', '/profile', deps)).toBe(true);
  const session = await deps.create('/model.onnx', '/profile');
  expect(session.run).toHaveBeenCalledTimes(4);
  expect(deps.loader).toHaveBeenCalledTimes(8);
  expect(session.release).toHaveBeenCalledOnce();
});
it('fails closed on missing loader, invalid audio, missing GPU profile or exceptions', async () => {
  const loader = dependencies();
  vi.mocked(loader.loader).mockResolvedValue(false);
  expect(await runGpuSelfTest('/model.onnx', '/profile', loader)).toBe(false);
  const output = dependencies();
  const session = await output.create('/x', '/y');
  vi.mocked(session.run).mockResolvedValue({ waveform: { data: Float32Array.from([Number.NaN]) } });
  expect(await runGpuSelfTest('/model.onnx', '/profile', output)).toBe(false);
  const cpu = dependencies();
  vi.mocked(cpu.profile).mockResolvedValue([]);
  expect(await runGpuSelfTest('/model.onnx', '/profile', cpu)).toBe(false);
  const failed = dependencies();
  vi.mocked(failed.create).mockRejectedValue(new Error('private'));
  expect(await runGpuSelfTest('/model.onnx', '/profile', failed)).toBe(false);
});

it('rejects non-finite audio even when the sample count is plausible', async () => {
  const deps = dependencies();
  const session = await deps.create('/model', '/profile');
  const audio = new Float32Array(2400);
  audio[4] = Number.NaN;
  vi.mocked(session.run).mockResolvedValue({ waveform: { data: audio } });
  expect(await runGpuSelfTest('/model', '/profile', deps)).toBe(false);
});

it('rejects malformed model output', async () => {
  const deps = dependencies();
  const session = await deps.create('/model', '/profile');
  vi.mocked(session.run).mockResolvedValue({ waveform: { data: 'not audio' } });
  expect(await runGpuSelfTest('/model', '/profile', deps)).toBe(false);
});

it('rejects a driver or loader identity change after any execution', async () => {
  const deps = dependencies();
  vi.mocked(deps.loader).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await runGpuSelfTest('/model.onnx', '/profile', deps)).toBe(false);
});
