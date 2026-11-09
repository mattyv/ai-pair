import { expect, it } from 'vitest';
import { gpuSessionOptions } from '../src/speech_gpu_options';

it('routes only the affected model node to CPU while strict probes stay GPU-only', () => {
  expect(gpuSessionOptions(false)).toEqual({
    executionProviders: [{ name: 'webgpu', forceCpuNodeNames: ['/decoder/decoder/generator/ups.1/ConvTranspose'] }],
    extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } } },
  });
  expect(gpuSessionOptions(true)).toEqual({
    executionProviders: ['webgpu'],
    extra: { ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } }, session: { disable_cpu_ep_fallback: '1' } },
  });
});
