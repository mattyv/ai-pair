import { describe, expect, it } from 'vitest';
import { hasGpuWork } from '../src/speech_gpu_profile';

describe('GPU profiling evidence', () => {
  it('accepts a completed WebGPU node with positive duration', () => {
    expect(hasGpuWork([{ cat: 'Node', dur: 5, args: { provider: 'WebGpuExecutionProvider', op_name: 'MatMul' } }])).toBe(true);
  });
  it.each([
    undefined,
    {},
    [],
    [{ cat: 'Node', dur: 3, args: { provider: 'CPUExecutionProvider' } }],
    [{ cat: 'Node', dur: 3, args: { provider: 'WebGpuExecutionProvider', op_name: 'MemcpyFromHost' } }],
    [{ cat: 'Node', dur: 0, args: { provider: 'WebGpuExecutionProvider' } }],
    [{ cat: 'Session', dur: 3, args: { provider: 'WebGpuExecutionProvider' } }],
    [{ cat: 'Node', dur: Infinity, args: { provider: 'WebGpuExecutionProvider' } }],
  ])('rejects incomplete or CPU-only evidence', (value) => {
    expect(hasGpuWork(value)).toBe(false);
  });
});
