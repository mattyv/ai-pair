import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentGate } from '../src/attachment_gate';

afterEach(() => {
  vi.useRealTimers();
});

describe('companion attachment gate', () => {
  it('does not register on prepare and permits only the matching commit once', () => {
    vi.useFakeTimers();
    const register = vi.fn<() => void>();
    const gate = new AttachmentGate({
      token: () => 'token',
      extension: { version: '0.47.0', build: 'abc' },
      timeoutMs: 100,
      register,
      retire: vi.fn<() => void>(),
    });
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    expect(response).toEqual({
      version: LOCAL_AUDIO_VERSION,
      epoch: 'epoch',
      token: 'token',
      extension: { version: '0.47.0', build: 'abc' },
    });
    expect(register).not.toHaveBeenCalled();
    expect(
      gate.commit({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        epoch: 'epoch',
        token: 'wrong',
        extension: { version: '0.47.0', build: 'abc' },
      }),
    ).toBe(false);
    expect(gate.commit(response)).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(gate.commit(response)).toBe(false);
    // The attached connection cannot be prepared again; a new epoch replaces it (#127, tested below).
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
  });

  it('expires preparation and rejects late commits without registering', () => {
    vi.useFakeTimers();
    const register = vi.fn<() => void>();
    const gate = new AttachmentGate({
      token: () => 'token',
      extension: { version: '0.47.0', build: 'abc' },
      timeoutMs: 100,
      register,
      retire: vi.fn<() => void>(),
    });
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    vi.advanceTimersByTime(100);
    expect(gate.commit(response)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'new' })).toEqual({
      version: LOCAL_AUDIO_VERSION,
      epoch: 'new',
      token: 'token',
      extension: { version: '0.47.0', build: 'abc' },
    });
    gate.dispose();
  });

  it('rejects malformed or overlapping preparations and stays committed if registration throws', () => {
    const gate = new AttachmentGate({
      token: () => 'token',
      extension: { version: '0.47.0', build: 'abc' },
      timeoutMs: 100,
      register: () => {
        throw new Error('failed');
      },
      retire: vi.fn<() => void>(),
    });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION - 1, epoch: 'epoch' })).toBeUndefined();
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'other' })).toBeUndefined();
    expect(() => gate.commit(response)).toThrow('failed');
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
    gate.dispose();
  });
  it('rejects an invalid generated token and all requests after disposal', () => {
    const gate = new AttachmentGate({
      token: () => '',
      extension: { version: '0.47.0', build: 'abc' },
      timeoutMs: 100,
      register: vi.fn<() => void>(),
      retire: vi.fn<() => void>(),
    });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
    gate.dispose();
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
    expect(
      gate.commit({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        epoch: 'epoch',
        token: 'token',
        extension: { version: '0.47.0', build: 'abc' },
      }),
    ).toBe(false);
  });

  it('CompanionCommit, SingleSession: a prepare for a new epoch retires the attachment first, then registers once committed (#127)', () => {
    vi.useFakeTimers();
    const register = vi.fn<() => void>();
    const retire = vi.fn<() => void>();
    const gate = new AttachmentGate({
      token: () => 'token',
      extension: { version: '0.48.4', build: 'abc' },
      timeoutMs: 100,
      register,
      retire,
    });
    const first = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'first' });
    expect(first).toBeDefined();
    expect(gate.commit(first)).toBe(true);
    // The attached epoch is still refused: only a new connection replaces it.
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'first' })).toBeUndefined();
    expect(retire).not.toHaveBeenCalled();
    const second = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'second' });
    expect(retire).toHaveBeenCalledOnce();
    expect(second).toMatchObject({ epoch: 'second' });
    expect(register).toHaveBeenCalledOnce();
    expect(gate.commit(second)).toBe(true);
    expect(register).toHaveBeenCalledTimes(2);
    gate.dispose();
  });
});
