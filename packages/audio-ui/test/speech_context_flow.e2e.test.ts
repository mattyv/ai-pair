import { expect, it, vi } from 'vitest';
vi.mock('../../vscode/src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));
import { mock } from 'vitest-mock-extended';
import { ACTION_SCHEMA, localAudioFrame, openRouterSpeechRequest, type LocalAudioFrame } from '@ai-pair/protocol';
import { defaultConfig } from '../../core/src/config';
import type { LineIds } from '../../core/src/lines';
import { Player, type Stage } from '../../core/src/player';
import type { PanelPort, PlayerEditor } from '../../core/src/ports';
import { instant } from '../../core/src/timeline';
import { RemoteNarration } from '../../vscode/src/remote_narration';
import { OpenRouterClient } from '../../vscode/src/speech_openrouter';
import { SpeechService } from '../../vscode/src/speech_service';
import { encodeTempoWav } from '../../vscode/src/speech_tempo_pcm';
import { CompanionNarration } from '../src/companion_narration';
import type { LocalSpeechObservation } from '../src/speech_host';

it('carries completed agent narration through the local audio protocol into a ZDR provider request', async () => {
  const bodies: unknown[] = [];
  const client = new OpenRouterClient(
    () => Promise.resolve('synthetic-key'),
    (input, init) => {
      expect(input instanceof Request ? input.url : String(input)).toContain('/audio/speech');
      if (typeof init?.body !== 'string') throw new Error('Expected JSON request');
      bodies.push(openRouterSpeechRequest.parse(JSON.parse(init.body)));
      return Promise.resolve(
        new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' } }),
      );
    },
    {
      admit: () =>
        Promise.resolve({
          signal: new AbortController().signal,
          decode: () => Promise.resolve(encodeTempoWav(new Int16Array([1, 2]), false)),
          cancel: () => {},
        }),
    },
  );
  let observation: LocalSpeechObservation | undefined;
  const played: number[] = [];
  const speech = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    openRouter: client,
    settings: () => ({
      enabled: true,
      contextEnabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'elevenlabs/eleven-v4',
      openRouterVoice: 'voice',
      openRouterZdr: true,
    }),
    output: {
      play: (id) => {
        played.push(id);
        return 1;
      },
      control: () => {},
      status: (id, state) => {
        observation = { id, state, started: state === 'speaking' || (observation?.id === id && observation.started) };
      },
    },
  });
  speech.setNarrationSession('session', true);
  speech.configureNarrationContext();
  let inbound = 0;
  let outbound = 0;
  const frames: LocalAudioFrame[] = [];
  const replies: LocalAudioFrame[] = [];
  let remote: RemoteNarration;
  const companion = new CompanionNarration({
    epoch: 'epoch',
    page: () => 1,
    speech,
    observation: () => observation,
    stopOutput: () => Promise.resolve(),
    nextSequence: () => ++outbound,
    send: (frame) => {
      replies.push(localAudioFrame.parse(frame));
      remote.ack(frame);
    },
  });
  remote = new RemoteNarration({
    epoch: 'epoch',
    page: () => 1,
    timeoutMs: 1000,
    nextSequence: () => ++inbound,
    send: (frame) => {
      frames.push(localAudioFrame.parse(frame));
      companion.receive(frame);
    },
  });
  const panel = mock<PanelPort>();
  const stage: Stage = {
    editor: mock<PlayerEditor>(),
    panel,
    lines: mock<LineIds>(),
    pacing: instant,
    config: () => defaultConfig,
    speed: () => 1,
    readingSpeed: () => 1,
    codePlayback: () => 'typing',
    narration: remote,
    render: () => {},
    confirm: () => Promise.resolve(true),
  };
  const player = new Player({ turn: 'agent', focus: 'cursor', pointFar: false, allowedCommands: new Set() }, stage);
  async function say(text: string, delivery: 'curious' | 'excited'): Promise<void> {
    const count = played.length;
    const pending = player.play(1, [ACTION_SCHEMA.parse({ say: text, speak: true, speech_delivery: delivery })]);
    await vi.waitFor(() => {
      expect(played.length).toBe(count + 1);
    });
    const id = played.at(-1);
    if (id === undefined) throw new Error('Missing playback');
    speech.audioEvent({ id, pageId: 1, event: 'started' });
    const terminal = speech.audioEvent({ id, pageId: 1, event: 'ended' });
    if (observation?.id === id && terminal !== undefined) observation = { ...observation, terminal };
    await pending;
  }
  await say('First words.', 'curious');
  speech.cancel();
  await say('Second words.', 'excited');
  expect(bodies).toEqual([
    { model: 'elevenlabs/eleven-v4', voice: 'voice', input: '[curious] First words.', response_format: 'pcm', provider: { zdr: true } },
    {
      model: 'elevenlabs/eleven-v4',
      voice: 'voice',
      input: '[excited] Second words.',
      response_format: 'pcm',
      provider: { zdr: true, options: { elevenlabs: { previous_text: 'First words.' } } },
    },
  ]);
  expect(replies.filter((frame) => frame.type === 'terminal').map((frame) => frame.outcome)).toEqual(['ended', 'ended']);
  expect(frames.filter((frame) => frame.type === 'speak').map((frame) => frame.delivery)).toEqual(['curious', 'excited']);
  expect(panel.post.mock.calls.map(([event]) => event)).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: 'First words.' }), expect.objectContaining({ text: 'Second words.' })]),
  );
  remote.dispose();
  companion.dispose();
  await speech.dispose();
});
