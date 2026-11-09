import { expect, it } from 'vitest';
import { gpuSessionOptions } from '../src/speech_gpu_options';

it('forces Vulkan for model and strict tiny graph sessions', () => {
  expect(gpuSessionOptions(false)).toEqual({
    executionProviders: ['webgpu'],
    extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } } },
  });
  expect(gpuSessionOptions(true)).toEqual({
    executionProviders: ['webgpu'],
    extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } }, session: { disable_cpu_ep_fallback: '1' } },
  });
});
