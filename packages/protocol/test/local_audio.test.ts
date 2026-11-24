import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localAudioFrame, LOCAL_AUDIO_VERSION } from '../src/local_audio';

const fake = vi.hoisted(() => ({ problem: vi.fn<(text: unknown) => string | undefined>() }));
vi.mock('../src/index', () => ({ speechProblem: fake.problem }));
beforeEach(() => {
  fake.problem.mockReset();
});

const base = { version: 13, connectionEpoch: 'connection-1', sequence: 1 };
const owner = { jobId: 'job-1', pageEpoch: 1 };

describe('local audio command frames', () => {
  it('accepts version 13 and rejects version 12 companion frames', () => {
    expect(localAudioFrame.safeParse({ ...base, version: 13, type: 'attach' }).success).toBe(true);
    expect(localAudioFrame.safeParse({ ...base, version: 12, type: 'attach' }).success).toBe(false);
  });
  it('accepts the bounded commands and terminal acknowledgements', () => {
    for (const frame of [
      { ...base, type: 'attach' },
      { ...base, type: 'heartbeat' },
      { ...base, type: 'panelChunk', pageEpoch: 1, messageId: 1, index: 0, count: 1, data: '{}' },
      { ...base, type: 'panelAction', pageEpoch: 1, action: { type: 'reply', text: 'Hello.' } },
      { ...base, ...owner, type: 'speak', text: 'A short narration.' },
      { ...base, ...owner, type: 'attentionCue' },
      { ...base, ...owner, type: 'pause' },
      { ...base, ...owner, type: 'resume' },
      { ...base, ...owner, type: 'cancel' },
      { ...base, ...owner, type: 'terminal', outcome: 'ended' },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(true);
    }
  });

  it('rejects wrong versions, unknown commands, extra keys and invalid identities', () => {
    for (const frame of [
      { ...base, type: 'attach', version: 3 },
      { ...base, type: 'exec', command: 'arbitrary' },
      { ...base, type: 'panelAction', pageEpoch: 1, action: { type: 'speechKeySet' } },
      { ...base, type: 'attach', secret: 'must not cross' },
      { ...base, type: 'heartbeat', sequence: 0 },
      { ...base, ...owner, type: 'pause', pageEpoch: -1 },
      { ...base, ...owner, type: 'cancel', jobId: '' },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(false);
    }
  });

  it('rejects narration when the shared text validator reports a problem', () => {
    fake.problem.mockReturnValue('invalid');
    expect(localAudioFrame.safeParse({ ...base, ...owner, type: 'speak', text: 'bad' }).success).toBe(false);
    expect(fake.problem).toHaveBeenCalledWith('bad');
  });
});

describe('speech delivery frame', () => {
  it('accepts a delivery on speak and rejects it elsewhere', () => {
    const deliveryBase = { version: LOCAL_AUDIO_VERSION, connectionEpoch: 'c', sequence: 1, jobId: 'j', pageEpoch: 1 };
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'speak', text: 'Hello', delivery: 'curious' }).success).toBe(true);
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'speak', text: 'Hello', delivery: 'angry' }).success).toBe(false);
    expect(localAudioFrame.safeParse({ ...deliveryBase, type: 'pause', delivery: 'neutral' }).success).toBe(false);
  });
});

describe('look-ahead frames (#108)', () => {
  it('accepts a page-scoped next line and its discard, without a job', () => {
    expect(localAudioFrame.safeParse({ ...base, type: 'prepareNext', pageEpoch: 1, text: 'Next.' }).success).toBe(true);
    expect(localAudioFrame.safeParse({ ...base, type: 'prepareNext', pageEpoch: 1, text: 'Next.', delivery: 'excited' }).success).toBe(
      true,
    );
    expect(localAudioFrame.safeParse({ ...base, type: 'unprepare', pageEpoch: 1 }).success).toBe(true);
  });

  it('refuses one with a job, without a page, or with unspeakable text', () => {
    expect(localAudioFrame.safeParse({ ...base, type: 'prepareNext', pageEpoch: 1, jobId: '1', text: 'Next.' }).success).toBe(false);
    expect(localAudioFrame.safeParse({ ...base, type: 'unprepare' }).success).toBe(false);
    fake.problem.mockReturnValueOnce('empty');
    expect(localAudioFrame.safeParse({ ...base, type: 'prepareNext', pageEpoch: 1, text: '' }).success).toBe(false);
  });
});

describe('local Facepalm frames', () => {
  it('accepts bounded asynchronous beat, retirement, feedback, settings and result frames', () => {
    const facepalmOwner = { pageEpoch: 1, generation: 1 };
    for (const frame of [
      { ...base, ...facepalmOwner, type: 'facepalmBeat', requestId: 1, kind: 'question', windowMs: 1500 },
      { ...base, ...facepalmOwner, type: 'facepalmRetire' },
      { ...base, ...facepalmOwner, type: 'facepalmFeel', id: 1, feeling: 'agreement' },
      { ...base, type: 'facepalmEnabled', enabled: false },
      { ...base, type: 'facepalmRefresh' },
      { ...base, type: 'facepalmOpenSettings' },
      { ...base, ...facepalmOwner, type: 'facepalmResult', requestId: 1, cue: { id: 1, feeling: 'agreement', feelings: ['agreement'] } },
      { ...base, ...facepalmOwner, type: 'facepalmResult', requestId: 1 },
      { ...base, type: 'facepalmStatus', snapshot: { enabled: true, status: 'idle', available: true, canOpenSettings: true } },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(true);
    }
  });

  it('TypeOK: rejects unbounded, malformed and credential-bearing frames', () => {
    const beat = { ...base, pageEpoch: 1, generation: 1, type: 'facepalmBeat', requestId: 1, kind: 'question', windowMs: 1500 };
    for (const frame of [
      { ...beat, windowMs: 10_001 },
      { ...beat, requestId: 0 },
      { ...beat, generation: -1 },
      { ...beat, token: 'secret' },
      { ...beat, kind: 'other' },
      {
        ...base,
        type: 'facepalmResult',
        pageEpoch: 1,
        generation: 1,
        requestId: 1,
        cue: { id: 1, feeling: 'unknown', feelings: Array.from({ length: 100 }, () => 'unknown') },
      },
    ]) {
      expect(localAudioFrame.safeParse(frame).success).toBe(false);
    }
  });
});
