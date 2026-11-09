import { expect, it } from 'vitest';
import { observedNoAdapter } from '../src/speech_gpu_negative';

it('recognizes only the expected explicit no-adapter error with verified loader', () => {
  expect(observedNoAdapter(new Error('Failed to get a WebGPU adapter: No supported adapters'), true)).toBe(true);
  expect(observedNoAdapter(new Error('Failed to get a WebGPU adapter: No supported adapters'), false)).toBe(false);
  for (const error of [undefined, 'No supported adapters', new Error('model missing'), new Error('No supported adapters'), new Error('timeout')]) {
    expect(observedNoAdapter(error, true)).toBe(false);
  }
});
