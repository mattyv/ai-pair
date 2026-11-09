import { expect, it } from 'vitest';
import { gpuEnvironment } from '../src/speech_gpu_environment';

it('uses only the selected driver and does not inherit loader, layer, or Node overrides', () => {
  expect(gpuEnvironment('/usr/share/vulkan/icd.d/radeon.json')).toEqual({
    LANG: 'C',
    VK_DRIVER_FILES: '/usr/share/vulkan/icd.d/radeon.json',
  });
});
