import { AUDIO_DIAGNOSTICS_SCHEMA } from '@ai-pair/protocol';
import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { LocalListener, LocalSynthesisPort } from '../src/speech_local_client';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import { voiceIndicator } from '../src/voice_indicator';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: () => Promise.resolve('/model') }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: () => Promise.resolve(true) }));

it('projects pre-session warmup through the service and lifecycle into the voice indicator', async () => {
  const facts = AUDIO_DIAGNOSTICS_SCHEMA.parse({
    enabled: true,
    provider: 'kokoro',
    keyConfigured: 'unknown',
    voiceConfigured: true,
    output: 'default',
    routeAvailable: true,
    runtimeReady: true,
    modelReady: true,
    lastPlayback: 'unknown',
  });
  const worker = mock<LocalSynthesisPort>();
  let listener: LocalListener | undefined;
  worker.state.mockReturnValue('loading');
  const output = mock<SpeechOutput>();
  const indicators: string[] = [];
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    output,
    createLocal: (owner) => {
      listener = owner;
      return worker;
    },
    computeChanged: (state) => {
      indicators.push(voiceIndicator(facts, state, true, true));
    },
  });
  worker.retire.mockImplementation(() => {
    listener?.reaped?.();
  });
  try {
    service.prepare();
    await vi.waitFor(() => {
      expect(worker.load).toHaveBeenCalledWith('/model');
    });
    expect(indicators.at(-1)).toBe('starting');
    expect(worker.synthesize).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
    worker.state.mockReturnValue('ready');
    listener?.ready();
    await vi.waitFor(() => {
      expect(indicators.at(-1)).toBe('ready');
    });
    expect(worker.synthesize).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
  } finally {
    await service.dispose();
  }
});
