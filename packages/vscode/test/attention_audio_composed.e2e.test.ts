import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { expect, it, vi } from 'vitest';
import { CompanionNarration } from '../../audio-ui/src/companion_narration';
import type { LocalSpeechObservation } from '../../audio-ui/src/speech_host';
import { SpeechService } from '../src/speech_service';
import { encodeTempoWav } from '../src/speech_tempo_pcm';
import { WorkspaceSession } from '../src/workspace_session';

vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));

it('synthesizes the remote attention cue and acknowledges completed playback', async () => {
  const played = vi.fn<(id: number) => void>();
  const synthesize = vi
    .fn<import('../src/speech_types').ElevenLabsSpeechPort['synthesize']>()
    .mockResolvedValue(encodeTempoWav(new Int16Array([1, 2]), false));
  let observation: LocalSpeechObservation | undefined;
  const speech = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    cloud: { synthesize, voices: () => Promise.resolve({ voices: [] }) },
    settings: () => ({ enabled: true, provider: 'elevenlabs', voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 }),
    output: {
      play: (id) => {
        played(id);
        return 7;
      },
      control: () => {},
      status: (id, state) => {
        observation = { id, state, started: state === 'speaking' || (observation?.id === id && observation.started) };
      },
    },
  });
  let sequence = 1;
  let companion: CompanionNarration;
  const terminals: unknown[] = [];
  const workspace = new WorkspaceSession({
    epoch: 'epoch',
    panel: { attachRemote: () => {}, receiveRemote: () => {}, closeRemote: () => {} },
    send: (frame) => {
      companion.receive(frame);
      return Promise.resolve();
    },
    lost: () => {},
  });
  try {
    companion = new CompanionNarration({
      epoch: 'epoch',
      speech,
      page: () => 1,
      nextSequence: () => ++sequence,
      observation: () => observation,
      stopOutput: () => Promise.resolve(),
      send: (frame) => {
        terminals.push(frame);
        workspace.accept(frame);
      },
    });
    workspace.accept({
      version: LOCAL_AUDIO_VERSION,
      connectionEpoch: 'epoch',
      sequence: 1,
      type: 'panelAction',
      pageEpoch: 1,
      action: { type: 'ready' },
    });
    const cue = workspace.narration.attentionCue();
    await vi.waitFor(() => {
      expect(synthesize).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(played).toHaveBeenCalled();
    });
    const id = played.mock.calls[0]?.[0];
    if (id === undefined) throw new Error('No playback');
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: "What's up?" }), expect.any(AbortSignal));
    speech.audioEvent({ id, pageId: 7, event: 'started' });
    const terminal = speech.audioEvent({ id, pageId: 7, event: 'ended' });
    if (observation !== undefined && terminal !== undefined) observation = { ...observation, terminal };
    await vi.waitFor(() => {
      expect(terminals).toHaveLength(1);
    });
    await cue;
    expect(terminals).toContainEqual(expect.objectContaining({ type: 'terminal', outcome: 'ended' }));
  } finally {
    workspace.dispose();
    await speech.dispose();
  }
});
