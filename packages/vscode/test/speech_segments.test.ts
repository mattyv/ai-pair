import { describe, expect, it } from 'vitest';
import { speechSegments } from '../src/speech_segments';

describe('speechSegments', () => {
  it('preserves every source character while grouping excess sentences into a fourth part', () => {
    const text = 'Dr. Smith paid 3.14. \u201cReady?\u201d Yes! Next. Last.  ';
    const parts = speechSegments(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(parts.join('')).toBe(text);
    expect(parts.every((part) => part.length > 0)).toBe(true);
  });

  it('keeps one sentence and Unicode without rewriting it', () => {
    expect(speechSegments('\u3053\u3093\u306b\u3061\u306f\u4e16\u754c\u3002')).toEqual([
      '\u3053\u3093\u306b\u3061\u306f\u4e16\u754c\u3002',
    ]);
    expect(speechSegments('Use const x = 2.')).toEqual(['Use const x = 2.']);
  });

  it('keeps the original when segmentation is unavailable or uncertain', () => {
    const text = 'First. Second.';
    expect(speechSegments(text, {})).toEqual([text]);
    expect(
      speechSegments(text, {
        segment: () => {
          throw new Error('unsupported');
        },
      }),
    ).toEqual([text]);
    expect(
      speechSegments(text, {
        segment: () => [
          { segment: 'First.', index: 0 },
          { segment: 'missing', index: 7 },
        ],
      }),
    ).toEqual([text]);
  });
});

it('keeps the full source when the segmenter stops before the end', () => {
  expect(speechSegments('First. Second.', { segment: () => [{ index: 0, segment: 'First. ' }] })).toEqual(['First. Second.']);
});
