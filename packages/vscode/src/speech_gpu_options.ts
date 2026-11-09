import type { InferenceSession } from 'onnxruntime-common';

/** Forces the pinned WebGPU provider to use Vulkan; strict probes forbid CPU fallback. */
export function gpuSessionOptions(strict: boolean): InferenceSession.SessionOptions {
  return {
    executionProviders: ['webgpu'],
    extra: {
      ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } },
      ...(strict ? { session: { disable_cpu_ep_fallback: '1' } } : {}),
    },
  };
}
