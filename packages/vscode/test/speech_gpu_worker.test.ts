import { expect, it, vi } from 'vitest';
import type { GpuWorkerChannel } from '../src/speech_gpu_worker_runtime';

const fake = vi.hoisted(() => ({
  attach: vi.fn<(channel: GpuWorkerChannel, args: string[], dependencies: unknown) => void>(),
  load: vi.fn(),
  verify: vi.fn(),
  verifyDriver: vi.fn(),
}));
vi.mock('../src/speech_gpu_worker_runtime', () => ({ attachGpuWorker: fake.attach }));
vi.mock('../src/speech_gpu_engine', () => ({ loadGpuSpeechEngine: fake.load }));
vi.mock('../src/speech_gpu_driver_identity', () => ({ verifyMappedGpuDriver: fake.verifyDriver }));
vi.mock('../src/speech_gpu_loader', () => ({ verifyMappedVulkanLoader: fake.verify }));

it('attaches the child runtime with its verified loader identity and IPC', async () => {
  await import('../src/speech_gpu_worker');
  expect(fake.attach).toHaveBeenCalledOnce();
  expect(fake.attach.mock.calls[0]?.[2]).toEqual({ load: fake.load, verify: fake.verify, verifyDriver: fake.verifyDriver });
  const channel = fake.attach.mock.calls[0]?.[0];
  if (channel === undefined) throw new Error('Missing channel');
  const message = vi.fn<(value: unknown) => void>();
  const disconnect = vi.fn<(value: unknown) => void>();
  channel.on('message', message);
  channel.on('disconnect', disconnect);
  process.removeListener('message', message);
  process.removeListener('disconnect', disconnect);
  const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
  const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected');
  const disconnectDescriptor = Object.getOwnPropertyDescriptor(process, 'disconnect');
  const send = vi.fn();
  const close = vi.fn();
  try {
    Object.defineProperty(process, 'send', { configurable: true, value: undefined });
    Object.defineProperty(process, 'connected', { configurable: true, value: false });
    expect(() => {
      channel.send({ type: 'failure', version: 1, category: 'load' });
    }).toThrow();
    Object.defineProperty(process, 'send', { configurable: true, value: send });
    Object.defineProperty(process, 'connected', { configurable: true, value: true });
    Object.defineProperty(process, 'disconnect', { configurable: true, value: close });
    channel.send({ type: 'failure', version: 1, category: 'load' });
    channel.close();
    expect(send).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    Object.defineProperty(process, 'connected', { configurable: true, value: false });
    channel.close();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    for (const [key, descriptor] of [
      ['send', sendDescriptor],
      ['connected', connectedDescriptor],
      ['disconnect', disconnectDescriptor],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(process, key);
      else Object.defineProperty(process, key, descriptor);
    }
  }
});
