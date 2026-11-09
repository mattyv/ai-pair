import { beforeEach, expect, it, vi } from 'vitest';
import { runGpuProofWorker } from '../src/speech_gpu_proof_worker';

const fake = vi.hoisted(() => ({
  create: vi.fn(),
  negative: vi.fn(),
  tiny: vi.fn<(graph: string, dependencies: import('../src/speech_gpu_tiny').GpuTinyDependencies) => Promise<boolean>>(),
  model:
    vi.fn<
      (model: string, prefix: string, dependencies: import('../src/speech_gpu_selftest').GpuSelfTestDependencies) => Promise<boolean>
    >(),
  loader: vi.fn(),
  driver: vi.fn(),
  noDriver: vi.fn(),
  options: vi.fn((strict: boolean) => ({ strict })),
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ readdir: fake.readdir, stat: fake.stat, readFile: fake.readFile }));
vi.mock('../src/speech_gpu_options', () => ({ gpuSessionOptions: fake.options }));
vi.mock('onnxruntime-node', () => ({
  InferenceSession: { create: fake.create }, // The runtime constructor is an unused collaborator in these cases.
  // oxlint-disable-next-line typescript/no-extraneous-class
  Tensor: class {},
}));
vi.mock('../src/speech_gpu_negative', () => ({ observedNoAdapter: fake.negative }));
vi.mock('../src/speech_gpu_tiny', () => ({ runGpuTiny: fake.tiny }));
vi.mock('../src/speech_gpu_selftest', () => ({ runGpuSelfTest: fake.model }));
vi.mock('../src/speech_gpu_driver_identity', () => ({ verifyMappedGpuDriver: fake.driver, verifyNoGpuDriver: fake.noDriver }));
vi.mock('../src/speech_gpu_loader', () => ({ verifyMappedVulkanLoader: fake.loader }));

beforeEach(() => {
  vi.clearAllMocks();
  fake.driver.mockResolvedValue(true);
  fake.noDriver.mockResolvedValue(true);
});

const options = {
  graph: '/runtime/tiny.onnx',
  model: '/model/model.onnx',
  profilePrefix: '/tmp/proof/profile',
  loaderPath: '/system/libvulkan.so',
  loaderSha256: 'a'.repeat(64),
  driver: { path: '/driver', sha256: 'b'.repeat(64), device: '42', inode: '99' },
};

it('accepts only an observed no-adapter error with verified loader', async () => {
  fake.create.mockRejectedValueOnce(new Error('private'));
  fake.loader.mockResolvedValueOnce(true);
  fake.negative.mockReturnValueOnce(true);
  expect(await runGpuProofWorker('negative', options)).toBe('rejected');
  expect(fake.negative).toHaveBeenCalledWith(expect.any(Error), true);
});

it('runs the tiny and repeated model proof helpers with forced Vulkan', async () => {
  fake.tiny.mockResolvedValueOnce(true);
  fake.model.mockResolvedValueOnce(true);
  expect(await runGpuProofWorker('tiny', options)).toBe('passed');
  expect(await runGpuProofWorker('model', options)).toBe('passed');
  expect(fake.tiny).toHaveBeenCalledWith(options.graph, expect.any(Object));
  expect(fake.model).toHaveBeenCalledWith(options.model, options.profilePrefix, expect.any(Object));
});

it('never accepts a session cleanup failure as a negative adapter result', async () => {
  fake.create.mockResolvedValueOnce({ release: () => Promise.reject(new Error('Failed to get a WebGPU adapter: No supported adapters')) });
  fake.loader.mockResolvedValue(true);
  fake.negative.mockReturnValue(true);
  expect(await runGpuProofWorker('negative', options)).toBe('failed');
});

it('adapts the tiny session and its fixed tensor without forwarding unchecked feeds', async () => {
  const session = { run: vi.fn(() => Promise.resolve({})), release: vi.fn(() => Promise.resolve()) };
  fake.create.mockResolvedValueOnce(session);
  fake.loader.mockResolvedValueOnce(true);
  fake.tiny.mockImplementationOnce(async (graph, dependencies) => {
    expect(graph).toBe(options.graph);
    const adapted = await dependencies.create(options.graph);
    const tensor = dependencies.tensor();
    await adapted.run({ X: tensor });
    expect(() => {
      void adapted.run({ X: 'invalid' });
    }).toThrow();
    expect(await dependencies.loader()).toBe(true);
    await adapted.release();
    return false;
  });
  expect(await runGpuProofWorker('tiny', options)).toBe('failed');
  expect(session.run).toHaveBeenCalledOnce();
  expect(session.release).toHaveBeenCalledOnce();
});

it('bounds and reads a single proof profile and adapts model tensors', async () => {
  const session = { run: vi.fn(() => Promise.resolve({})), release: vi.fn(() => Promise.resolve()), endProfiling: vi.fn() };
  fake.create.mockResolvedValueOnce(session);
  fake.loader.mockResolvedValueOnce(true);
  fake.readdir.mockResolvedValue(['profile.json']);
  fake.stat.mockResolvedValue({ isFile: () => true, size: 2 });
  fake.readFile.mockResolvedValue('[]');
  fake.model.mockImplementationOnce(async (model, prefix, dependencies) => {
    expect(model).toBe(options.model);
    expect(prefix).toBe(options.profilePrefix);
    const adapted = await dependencies.create(options.model, options.profilePrefix);
    const first = dependencies.tensor('int64', new BigInt64Array(1), [1]);
    const second = dependencies.tensor('float32', new Float32Array(1), [1]);
    await adapted.run({ first, second });
    expect(() => {
      dependencies.tensor('float32', new BigInt64Array(1), [1]);
    }).toThrow();
    adapted.endProfiling();
    expect(await dependencies.loader()).toBe(true);
    expect(await dependencies.profile()).toEqual([]);
    fake.readdir.mockResolvedValueOnce([]);
    await expect(dependencies.profile()).rejects.toThrow();
    fake.stat.mockResolvedValueOnce({ isFile: () => false, size: 2 });
    await expect(dependencies.profile()).rejects.toThrow();
    fake.stat.mockResolvedValueOnce({ isFile: () => true, size: 40_000_000 });
    await expect(dependencies.profile()).rejects.toThrow();
    await adapted.release();
    return false;
  });
  expect(await runGpuProofWorker('model', options)).toBe('failed');
  expect(session.endProfiling).toHaveBeenCalledOnce();
  expect(session.release).toHaveBeenCalledOnce();
});

it('does not accept an unverified no-adapter result or a successful negative graph', async () => {
  fake.create.mockRejectedValueOnce(new Error('private'));
  fake.loader.mockResolvedValueOnce(false);
  fake.negative.mockReturnValueOnce(false);
  expect(await runGpuProofWorker('negative', options)).toBe('failed');
  fake.create.mockResolvedValueOnce({ release: () => Promise.resolve() });
  expect(await runGpuProofWorker('negative', options)).toBe('failed');
});

it('fails closed on malformed child arguments', async () => {
  const original = [...process.argv];
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  try {
    process.argv = ['node', 'worker', '--ai-pair-gpu-proof', 'bad'];
    vi.resetModules();
    await expect(import('../src/speech_gpu_proof_worker')).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    process.argv = original;
    exit.mockRestore();
    vi.resetModules();
  }
});

it.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])('sends fixed outcome success=%s connected=%s', async (succeeds, staysConnected) => {
  const original = [...process.argv];
  const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
  const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected');
  const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, 'disconnect');
  const disconnect = vi.fn<() => void>();
  const send = vi.fn<(message: unknown, callback: (error: Error | null) => void) => void>((message, callback) => {
    void message;
    if (!staysConnected) Object.defineProperty(process, 'connected', { configurable: true, value: false });
    // Node reports success with null.
    // oxlint-disable-next-line unicorn/no-null
    callback(null);
  });
  try {
    process.argv = ['node', 'worker', '--ai-pair-gpu-proof', 'tiny', '/graph', '/model', '/tmp/profile', '/loader', 'a'.repeat(64), '/driver', 'b'.repeat(64), '42', '99'];
    Object.defineProperty(process, 'send', { configurable: true, value: send });
    Object.defineProperty(process, 'connected', { configurable: true, value: true });
    Object.defineProperty(process, 'disconnect', { configurable: true, value: disconnect });
    if (succeeds) fake.tiny.mockResolvedValueOnce(true);
    else fake.tiny.mockRejectedValueOnce(new Error('private'));
    vi.resetModules();
    await import('../src/speech_gpu_proof_worker');
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
    expect(send.mock.calls[0]?.[0]).toEqual({ type: 'gpu-proof', kind: 'tiny', result: succeeds ? 'passed' : 'failed' });
    expect(disconnect).toHaveBeenCalledTimes(staysConnected ? 1 : 0);
  } finally {
    process.argv = original;
    for (const [key, descriptor] of [
      ['send', sendDescriptor],
      ['connected', connectedDescriptor],
      ['disconnect', disconnectDescriptor],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(process, key);
      else Object.defineProperty(process, key, descriptor);
    }
    vi.resetModules();
  }
});

it.each([
  [true, 'tiny'],
  [false, 'tiny'],
  [true, 'model'],
] as const)('disconnected result success=%s kind=%s', async (succeeds, kind) => {
  const original = [...process.argv];
  const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
  const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected');
  const send = vi.fn();
  try {
    process.argv = ['node', 'worker', '--ai-pair-gpu-proof', kind, '/graph', '/model', '/tmp/profile', '/loader', 'a'.repeat(64), '/driver', 'b'.repeat(64), '42', '99'];
    Object.defineProperty(process, 'send', { configurable: true, value: send });
    Object.defineProperty(process, 'connected', { configurable: true, value: false });
    if (kind === 'model') fake.model.mockResolvedValueOnce(true);
    else if (succeeds) fake.tiny.mockResolvedValueOnce(true);
    else fake.tiny.mockRejectedValueOnce(new Error('private'));
    vi.resetModules();
    await import('../src/speech_gpu_proof_worker');
    await Promise.resolve();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  } finally {
    process.argv = original;
    for (const [key, descriptor] of [
      ['send', sendDescriptor],
      ['connected', connectedDescriptor],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(process, key);
      else Object.defineProperty(process, key, descriptor);
    }
    vi.resetModules();
  }
});

it('rejects the negative control when a GPU driver remains mapped', async () => {
  fake.create.mockRejectedValueOnce(new Error('private'));
  fake.loader.mockResolvedValueOnce(true);
  fake.noDriver.mockResolvedValueOnce(false);
  fake.negative.mockReturnValueOnce(false);
  expect(await runGpuProofWorker('negative', options)).toBe('failed');
  expect(fake.negative).toHaveBeenCalledWith(expect.any(Error), false);
  expect(fake.driver).not.toHaveBeenCalled();
});

it('requires the exact mapped driver during positive proof', async () => {
  fake.loader.mockResolvedValue(true);
  fake.driver.mockResolvedValue(false);
  fake.tiny.mockImplementation(async (graph, dependencies) => { void graph; return dependencies.loader(); });
  expect(await runGpuProofWorker('tiny', options)).toBe('failed');
  expect(fake.driver).toHaveBeenCalledWith(options.driver, options.loaderPath);
  expect(fake.noDriver).not.toHaveBeenCalled();
});
