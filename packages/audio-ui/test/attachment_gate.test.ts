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
    const gate = new AttachmentGate({ token: () => 'token', timeoutMs: 100, register });
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    expect(response).toEqual({ version: LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token' });
    expect(register).not.toHaveBeenCalled();
    expect(gate.commit({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'wrong' })).toBe(false);
    expect(gate.commit(response)).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(gate.commit(response)).toBe(false);
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'other' })).toBeUndefined();
  });

  it('expires preparation and rejects late commits without registering', () => {
    vi.useFakeTimers();
    const register = vi.fn<() => void>();
    const gate = new AttachmentGate({ token: () => 'token', timeoutMs: 100, register });
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    vi.advanceTimersByTime(100);
    expect(gate.commit(response)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'new' })).toEqual({
      version: LOCAL_AUDIO_VERSION,
      epoch: 'new',
      token: 'token',
    });
    gate.dispose();
  });

  it('rejects malformed or overlapping preparations and stays committed if registration throws', () => {
    const gate = new AttachmentGate({
      token: () => 'token',
      timeoutMs: 100,
      register: () => {
        throw new Error('failed');
      },
    });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION - 1, epoch: 'epoch' })).toBeUndefined();
    const response = gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'other' })).toBeUndefined();
    expect(() => gate.commit(response)).toThrow('failed');
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'other' })).toBeUndefined();
    gate.dispose();
  });
  it('rejects an invalid generated token and all requests after disposal', () => {
    const gate = new AttachmentGate({ token: () => '', timeoutMs: 100, register: vi.fn<() => void>() });
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
    gate.dispose();
    expect(gate.prepare({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch' })).toBeUndefined();
    expect(gate.commit({ version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'epoch', token: 'token' })).toBe(false);
  });
});
