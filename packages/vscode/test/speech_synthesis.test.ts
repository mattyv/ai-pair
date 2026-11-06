import { describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech } from '../src/speech_synthesis';
import { checkedTokenCount, encodeSpeechWav } from '../src/speech_audio';

vi.mock('../src/speech_audio', () => ({
  checkedTokenCount: vi.fn((count: number) => {
    if (count <= 2 || count > 512) throw new Error('token bounds');
    return count - 2;
  }),
  encodeSpeechWav: vi.fn(() => new Uint8Array(46)),
}));

/** Makes the isolated engine boundary used by these tests. */
function engine(count: number, samples = new Float32Array([0.5])) {
  const ids = { dims: [1, count] };
  return {
    phonemize: vi.fn().mockResolvedValue('phonemes'),
    tokenize: vi.fn().mockReturnValue(ids),
    generate: vi.fn().mockResolvedValue({ samples, rate: 24000 }),
    ids,
  };
}

describe('synthesizeSpeech', () => {
  it('generates from the same checked untruncated tokens', async () => {
    const fake = engine(3);
    const result = await synthesizeSpeech(fake, { text: 'One idea.', voice: 'af_heart', speed: 1 });
    expect(fake.phonemize).toHaveBeenCalledWith('One idea.', 'a');
    expect(fake.tokenize).toHaveBeenCalledWith('phonemes');
    expect(checkedTokenCount).toHaveBeenCalledWith(3);
    expect(fake.generate).toHaveBeenCalledWith(fake.ids, 'af_heart', 1);
    expect(encodeSpeechWav).toHaveBeenCalledWith(new Float32Array([0.5]), 24000);
    expect(result.wav.length).toBeGreaterThan(44);
    expect(result.durationMs).toBeCloseTo(600 + 1000 / 24000);
  });

  it('uses British phonemes for British voices', async () => {
    const fake = engine(3);
    await synthesizeSpeech(fake, { text: 'Hello.', voice: 'bf_emma', speed: 1 });
    expect(fake.phonemize).toHaveBeenCalledWith('Hello.', 'b');
  });

  it('never runs inference for boundary-only or overlong tokens', async () => {
    for (const count of [2, 513]) {
      const fake = engine(count);
      await expect(synthesizeSpeech(fake, { text: '{}', voice: 'af_heart', speed: 1 })).rejects.toThrow();
      expect(fake.generate).not.toHaveBeenCalled();
    }
  });
});
