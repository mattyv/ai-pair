import type { InferenceSession } from 'onnxruntime-common';

// The separately bundled GPU runtime supports this provider option; the root
// project's older CPU runtime types do not yet declare it.
const MODEL_PROVIDER = { name: 'webgpu' as const, forceCpuNodeNames: ['/decoder/decoder/generator/ups.1/ConvTranspose'] };

/** Forces the pinned WebGPU provider to use Vulkan; strict probes forbid CPU fallback. */
export function gpuSessionOptions(strict: boolean): InferenceSession.SessionOptions {
  return {
    executionProviders: strict ? ['webgpu'] : [MODEL_PROVIDER],
    extra: {
      ep: { webgpuexecutionprovider: { dawnBackendType: 'Vulkan' } },
      ...(strict ? { session: { disable_cpu_ep_fallback: '1' } } : {}),
    },
  };
}
