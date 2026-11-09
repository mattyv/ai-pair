import { expect, it } from 'vitest';
import { GpuModelTimeoutError } from '../src/speech_gpu_model_error';

it('uses a fixed timeout message without private details', () => {
  expect(new GpuModelTimeoutError().message).toBe('GPU model download timed out.');
});
