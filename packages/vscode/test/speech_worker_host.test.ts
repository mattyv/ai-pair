import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_CAPABILITIES,
  LOCAL_PROTOCOL_VERSION,
  LOCAL_REQUEST,
  LOCAL_RESPONSE,
  type LocalResponse,
} from '../src/speech_local_protocol';
import { synthesizeSpeech, type SpeechEngine, type SpeechTokens } from '../src/speech_synthesis';
import { SpeechWorkerHost } from '../src/speech_worker_host';

vi.mock('../src/speech_synthesis', () => ({ synthesizeSpeech: vi.fn() }));

const version = LOCAL_PROTOCOL_VERSION;
const WAV = new Uint8Array(44);
const init = { type: 'init', version, epoch: 3, modelPath: '/model' };
const request = { type: 'synthesize', version, epoch: 3, id: 1, part: 0, final: true, text: 'Hello.', voice: 'af_heart', speed: 1 };

/** Makes a host whose every reply is checked against the shared response schema. */
function harness(load = vi.fn<(modelPath: string) => Promise<SpeechEngine<SpeechTokens>>>()) {
  const engine: SpeechEngine<SpeechTokens> = { phonemize: vi.fn(), tokenize: vi.fn(), generate: vi.fn() };
  load.mockResolvedValue(engine);
  const replies: LocalResponse[] = [];
  const host = new SpeechWorkerHost(load, (message) => {
    replies.push(LOCAL_RESPONSE.parse(message));
  });
  return { host, load, engine, replies };
}

beforeEach(() => {
  vi.mocked(synthesizeSpeech).mockResolvedValue({ wav: WAV, durationMs: 1000 });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('SpeechWorkerHost', () => {
  it('OneEngine: loads the host-supplied model once and reports the host capabilities for the epoch', async () => {
    const { host, load, replies } = harness();
    await host.receive(LOCAL_REQUEST.parse(init));
    expect(load).toHaveBeenCalledExactlyOnceWith('/model');
    expect(replies).toEqual([
      {
        type: 'ready',
        version,
        epoch: 3,
        capabilities: { ...LOCAL_CAPABILITIES, voices: [...LOCAL_CAPABILITIES.voices], speeds: [...LOCAL_CAPABILITIES.speeds] },
      },
    ]);
  });

  it('OneEngine: refuses a second init, even after the first load failed', async () => {
    const { host, load, replies } = harness();
    load.mockRejectedValueOnce(new Error('secret'));
    await host.receive(init);
    await host.receive({ ...init, epoch: 4 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([
      { type: 'failure', version, epoch: 3, category: 'load' },
      { type: 'failure', version, epoch: 3, category: 'protocol' },
    ]);
    expect(JSON.stringify(replies)).not.toContain('secret');
  });

  it('OneEngine: refuses a second init while the first is loading', async () => {
    const pending = Promise.withResolvers<SpeechEngine<SpeechTokens>>();
    const { host, load, replies } = harness();
    load.mockReturnValueOnce(pending.promise);
    const first = host.receive(init);
    await host.receive(init);
    expect(replies).toEqual([{ type: 'failure', version, epoch: 3, category: 'protocol' }]);
    pending.resolve({ phonemize: vi.fn(), tokenize: vi.fn(), generate: vi.fn() });
    await first;
    expect(replies.at(-1)?.type).toBe('ready');
  });

  it('CorrectDelivery: echoes the epoch, unit and part of a synthesis and requests a final-only tail', async () => {
    const { host, engine, replies } = harness();
    await host.receive(init);
    await host.receive({ ...request, id: 5, part: 2, final: false, text: 'One.' });
    expect(synthesizeSpeech).toHaveBeenCalledWith(engine, { text: 'One.', voice: 'af_heart', speed: 1, final: false });
    expect(replies.at(-1)).toEqual({ type: 'result', version, epoch: 3, id: 5, part: 2, wav: WAV, durationMs: 1000 });
  });

  it('CorrectDelivery: rejects a request for another epoch or before init without synthesizing', async () => {
    const { host, replies } = harness();
    await host.receive(request);
    await host.receive(init);
    await host.receive({ ...request, epoch: 4 });
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(replies.slice(2)).toEqual([{ type: 'failure', version, epoch: 3, id: 1, part: 0, category: 'protocol' }]);
    expect(replies[0]).toEqual({ type: 'failure', version, id: 1, part: 0, category: 'protocol' });
  });

  it('OneEngine: allows one inference and answers a concurrent request busy', async () => {
    const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
    vi.mocked(synthesizeSpeech).mockReturnValueOnce(pending.promise);
    const { host, replies } = harness();
    await host.receive(init);
    const first = host.receive(request);
    await host.receive({ ...request, id: 2 });
    expect(replies.at(-1)).toEqual({ type: 'failure', version, epoch: 3, id: 2, part: 0, category: 'busy' });
    pending.resolve({ wav: WAV, durationMs: 1000 });
    await first;
    expect(replies.at(-1)?.type).toBe('result');
    await host.receive({ ...request, id: 3 });
    expect(replies.at(-1)).toMatchObject({ type: 'result', id: 3 });
  });

  it('reports a failed synthesis as a fixed category without echoing the text', async () => {
    const { host, replies } = harness();
    await host.receive(init);
    vi.mocked(synthesizeSpeech).mockRejectedValueOnce(new Error('secret input'));
    await host.receive({ ...request, text: 'secret input' });
    expect(replies.at(-1)).toEqual({ type: 'failure', version, epoch: 3, id: 1, part: 0, category: 'synthesis' });
    expect(JSON.stringify(replies)).not.toContain('secret');
    await host.receive({ ...request, id: 2 });
    expect(replies.at(-1)?.type).toBe('result');
  });

  it('answers malformed input with a protocol failure before and after init, without echoing it', async () => {
    const { host, replies } = harness();
    await host.receive({ type: 'bad', text: 'secret' });
    await host.receive(init);
    await host.receive({ ...request, voice: 'secret' });
    expect(replies.filter((reply) => reply.type === 'failure')).toEqual([
      { type: 'failure', version, category: 'protocol' },
      { type: 'failure', version, epoch: 3, category: 'protocol' },
    ]);
    expect(JSON.stringify(replies)).not.toContain('secret');
  });

  it('shutdown drops the engine so nothing more is synthesized', async () => {
    const { host, replies } = harness();
    await host.receive(init);
    await host.receive({ type: 'shutdown', version });
    await host.receive(request);
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(replies.at(-1)).toEqual({ type: 'failure', version, epoch: 3, id: 1, part: 0, category: 'protocol' });
  });
});
