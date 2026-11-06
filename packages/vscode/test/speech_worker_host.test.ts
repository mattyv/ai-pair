import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { synthesizeSpeech, type SpeechEngine, type SpeechTokens } from '../src/speech_synthesis';
import { SPEECH_WORKER_INPUT, SPEECH_WORKER_OUTPUT } from '../src/speech_worker_messages';
import { SpeechWorkerHost } from '../src/speech_worker_host';

vi.mock('../src/speech_synthesis', () => ({ synthesizeSpeech: vi.fn() }));

describe('SpeechWorkerHost', () => {
  it('loads once, then sends a schema-checked audio result for the matching request', async () => {
    const engine = mock<SpeechEngine<SpeechTokens>>();
    const load = vi.fn().mockResolvedValue(engine);
    const post = vi.fn((message: unknown) => SPEECH_WORKER_OUTPUT.parse(message));
    vi.mocked(synthesizeSpeech).mockResolvedValue({ wav: new Uint8Array([1]), durationMs: 1 });
    const worker = new SpeechWorkerHost(load, post);
    await worker.receive(SPEECH_WORKER_INPUT.parse({ type: 'load', modelPath: '/model' }));
    expect(post).toHaveBeenCalledWith({ type: 'ready' });
    await worker.receive(SPEECH_WORKER_INPUT.parse({ type: 'synthesize', id: 1, text: 'Hello.', voice: 'af_heart', speed: 1 }));
    expect(synthesizeSpeech).toHaveBeenCalledWith(engine, { text: 'Hello.', voice: 'af_heart', speed: 1 });
    expect(post).toHaveBeenCalledWith({ type: 'audio', id: 1, wav: new Uint8Array([1]), durationMs: 1 });
  });

  it('reports invalid input, missing model, and load or synthesis errors without echoing text', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('secret'));
    const post = vi.fn((message: unknown) => SPEECH_WORKER_OUTPUT.parse(message));
    const worker = new SpeechWorkerHost(load, post);
    await worker.receive({ type: 'bad' });
    await worker.receive({ type: 'synthesize', id: 1, text: 'secret', voice: 'af_heart', speed: 1 });
    await worker.receive({ type: 'load', modelPath: '/model' });
    expect(post.mock.calls.map(([value]) => JSON.stringify(value)).join()).not.toContain('secret');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('refuses a second job while one is outstanding', async () => {
    let finish: (value: { wav: Uint8Array; durationMs: number }) => void = () => {};
    vi.mocked(synthesizeSpeech).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const post = vi.fn((message: unknown) => SPEECH_WORKER_OUTPUT.parse(message));
    const worker = new SpeechWorkerHost(vi.fn().mockResolvedValue(mock<SpeechEngine<SpeechTokens>>()), post);
    await worker.receive({ type: 'load', modelPath: '/model' });
    const request = { type: 'synthesize', id: 1, text: 'Hello.', voice: 'af_heart', speed: 1 };
    const first = worker.receive(request);
    await worker.receive({ ...request, id: 2 });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', id: 2 }));
    finish({ wav: new Uint8Array([1]), durationMs: 1 });
    await first;
  });
});
