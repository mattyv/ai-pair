import { describe, expect, it, vi } from 'vitest';
import { HelperEventFrames, parseHelperEvent } from '../src/protocol';

describe('native helper event protocol', () => {
  it('accepts only the fixed event types and a matching protocol version', () => {
    for (const type of ['ready', 'started', 'paused', 'resumed', 'ended', 'canceled', 'failed', 'retired']) {
      expect(parseHelperEvent(JSON.stringify({ version: 1, sequence: 0, type }))).toEqual({ version: 1, sequence: 0, type });
    }
    expect(parseHelperEvent('{"version":2,"sequence":0,"type":"ready"}')).toBeUndefined();
    expect(parseHelperEvent('{"version":1,"sequence":0,"type":"unexpected"}')).toBeUndefined();
  });

  it('rejects malformed, oversized, and extra data rather than passing it to diagnostics', () => {
    expect(parseHelperEvent('not json')).toBeUndefined();
    expect(
      parseHelperEvent(JSON.stringify({ version: 1, sequence: 0, type: 'failed', message: 'raw error or device id' })),
    ).toBeUndefined();
    expect(parseHelperEvent(' '.repeat(4097))).toBeUndefined();
    expect(parseHelperEvent('null')).toBeUndefined();
  });
});

it('checks the UTF-8 byte limit and rejects non-object or incomplete events', () => {
  expect(parseHelperEvent(JSON.stringify({ version: 1, type: 'ready', padding: '\u00E9'.repeat(2050) }))).toBeUndefined();
  expect(parseHelperEvent('[]')).toBeUndefined();
  expect(parseHelperEvent('{"version":1}')).toBeUndefined();
  expect(parseHelperEvent('{"version":1,"type":5}')).toBeUndefined();
  expect(parseHelperEvent('{"type":"ready","other":1}')).toBeUndefined();
});

it('requires a bounded nonnegative helper-event sequence', () => {
  for (const sequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0']) {
    expect(parseHelperEvent(JSON.stringify({ version: 1, sequence, type: 'started' }))).toBeUndefined();
  }
  expect(parseHelperEvent(JSON.stringify({ version: 1, sequence: 1, type: 'started' }))).toEqual({
    version: 1,
    sequence: 1,
    type: 'started',
  });
});

it('handles fragmented and coalesced event frames while rejecting stale sequences', () => {
  const events: unknown[] = [];
  const frames = new HelperEventFrames((event) => {
    events.push(event);
  });
  expect(frames.push(Buffer.from('{"version":1,"sequence":0,'))).toBe(true);
  expect(events).toEqual([]);
  expect(frames.push(Buffer.from('"type":"ready"}\n{"version":1,"sequence":1,"type":"started"}\n'))).toBe(true);
  expect(events).toEqual([
    { version: 1, sequence: 0, type: 'ready' },
    { version: 1, sequence: 1, type: 'started' },
  ]);
  expect(frames.push(Buffer.from('{"version":1,"sequence":1,"type":"ended"}\n'))).toBe(false);
});

it('rejects malformed and oversized fragments without emitting partial events', () => {
  const emit = vi.fn<() => void>();
  const frames = new HelperEventFrames(emit);
  expect(frames.push(Buffer.alloc(4097, 32))).toBe(false);
  expect(emit).not.toHaveBeenCalled();
  expect(new HelperEventFrames(emit).push(Buffer.from('bad\n'))).toBe(false);
  expect(emit).not.toHaveBeenCalled();
});

it('rejects invalid UTF-8 and remains failed after any protocol violation', () => {
  const frames = new HelperEventFrames(vi.fn<() => void>());
  expect(frames.push(Buffer.from([0xff, 10]))).toBe(false);
  expect(frames.push(Buffer.from('{"version":1,"sequence":0,"type":"ready"}\n'))).toBe(false);
});

it('requires a complete final frame when the helper pipe closes', () => {
  const complete = new HelperEventFrames(vi.fn<() => void>());
  expect(complete.push(Buffer.from('{"version":1,"sequence":0,"type":"retired"}\n'))).toBe(true);
  expect(complete.finish()).toBe(true);
  const partial = new HelperEventFrames(vi.fn<() => void>());
  expect(partial.push(Buffer.from('{"version":1'))).toBe(true);
  expect(partial.finish()).toBe(false);
});
