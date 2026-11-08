import { expect, it, vi } from 'vitest';
import { SpeechService, type SpeechOutput, type SpeechTempoProcessor } from '../src/speech_service';
import { encodeTempoWav } from '../src/speech_tempo_pcm';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

it('transforms tail-free provider PCM and adds exactly one final tail', async () => {
  const original = new Int16Array([100, -100, 50]);
  const changed = new Int16Array([100, -100]);
  const provider = encodeTempoWav(original, true);
  const expected = encodeTempoWav(changed, true);
  const transform = vi.fn<SpeechTempoProcessor['transform']>().mockResolvedValue(changed);
  const output: SpeechOutput = { play: vi.fn(() => 4), control: vi.fn<SpeechOutput['control']>(), status: vi.fn<SpeechOutput['status']>() };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    settings: () => ({
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'voice',
      elevenLabsSpeed: 1,
      listeningSpeed: 1.25,
    }),
    output,
    cloud: { synthesize: vi.fn().mockResolvedValue(provider), voices: vi.fn() },
    tempo: { transform, dispose: vi.fn().mockResolvedValue(undefined) },
  });
  const finished = service.speak('A short sentence.');
  await vi.waitFor(() => {
    expect(output.play).toHaveBeenCalledWith(1, expected.wav, expected.durationMs);
  });
  expect(transform.mock.calls[0]?.[0].pcm).toEqual(original);
  service.audioEvent({ id: 1, pageId: 4, event: 'ended' });
  await finished;
});
