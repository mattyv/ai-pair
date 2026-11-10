import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { setupGpuFlow } from '../src/speech_gpu_setup_flow';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { LocalListener, LocalSynthesisPort } from '../src/speech_local_client';
import type { GpuLaunchCapability } from '../src/speech_gpu_client';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: () => Promise.resolve('/cpu') }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: () => Promise.resolve(true) }));

it('runs verified setup then dispatches a GPU unit through a controlled worker port', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  try {
    const capability = mock<GpuLaunchCapability>({ modelDirectory: '/gpu' });
    const issue = vi
      .fn<() => Promise<import('../src/speech_gpu_capability').GpuCapabilityResult>>()
      .mockResolvedValue({ check: { phase: 'ready' }, capability });
    const cpu = mock<LocalSynthesisPort>();
    cpu.state.mockReturnValue('cold');
    cpu.busy.mockReturnValue(false);
    const gpu = mock<LocalSynthesisPort>();
    let phase: 'cold' | 'loading' | 'ready' = 'cold';
    gpu.state.mockImplementation(() => phase);
    gpu.busy.mockReturnValue(false);
    gpu.load.mockImplementation(() => {
      phase = 'loading';
    });
    gpu.synthesize.mockResolvedValue({ status: 'audio', wav: new Uint8Array(44), durationMs: 100 });
    let listener: LocalListener | undefined;
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    output.play.mockReturnValue(7);
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      createLocal: () => cpu,
      gpuCapability: issue,
      createGpu: (verified, owner) => {
        expect(verified).toBe(capability);
        listener = owner;
        return gpu;
      },
      computeMode: () => 'gpu',
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    const check = await service.checkGpu(
      (signal, progress) =>
        setupGpuFlow({
          preflight: () => Promise.resolve({ phase: 'ready' }),
          cpuModel: () => Promise.resolve('/cpu'),
          gpuModel: () => Promise.resolve('/gpu'),
          download: () => Promise.resolve('/gpu'),
          verify: async () => (await issue()).check,
          signal,
          progress,
        }),
      new AbortController().signal,
    );
    expect(check).toEqual({ phase: 'ready' });
    expect(service.computeState().gpuCheck).toEqual({ phase: 'ready' });
    const unit = service.speak('Hello.');
    await vi.waitFor(() => {
      expect(gpu.load).toHaveBeenCalledWith('/gpu');
    });
    phase = 'ready';
    listener?.ready();
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledOnce();
    });
    expect(service.computeState().actualBackend).toBe('gpu');
    expect(issue).toHaveBeenCalledTimes(2);
    expect(cpu.load).not.toHaveBeenCalled();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await unit;
    gpu.retire.mockImplementation(() => {
      listener?.reaped?.();
    });
    await service.dispose();
  } finally {
    if (originalPlatform !== undefined) Object.defineProperty(process, 'platform', originalPlatform);
    if (originalArch !== undefined) Object.defineProperty(process, 'arch', originalArch);
  }
});
