// How typing is paced, and how long a message takes to read; and planTyping over every small text, the properties
// specs/Typing.tla checks on its model. typing.ts imports only types, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { groupTyping, planTyping, readingTime } from '../src/typing';

/** A typing pace with no jitter, so each pause is the same every run. */
const CADENCE = { charMs: 100, jitter: 0, wordStartMs: 50, punctuationMs: 30, openBracketMs: 20, newlineMs: 250 };

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000;

const CHARS = ['x', ' ', '\t', '\n', '(', '"', "'"];

/** Returns each chunk planTyping makes of `text` at CADENCE, with its delay. */
function delays(text: string, atLineStart = false): Array<[string, number]> {
  return planTyping(text, CADENCE, atLineStart, Math.random).map((c) => [c.text, c.delay]);
}

describe('typing', () => {
  it.each(['"', "'"])('types a run of three or more %s quotes in one edit without losing cadence', (quote) => {
    expect(delays(`${quote.repeat(3)}x${quote.repeat(4)}`)).toEqual([
      [quote.repeat(3), 300],
      ['x', 150],
      [quote.repeat(4), 400],
    ]);
    expect(delays(quote.repeat(6))).toEqual([[quote.repeat(6), 600]]);
    expect(delays(quote.repeat(5))).toEqual([[quote.repeat(5), 500]]);
    expect(delays(quote.repeat(7))).toEqual([[quote.repeat(7), 700]]);
    expect(delays(quote.repeat(2))).toEqual([
      [quote, 100],
      [quote, 100],
    ]);
  });

  it('keeps mixed quote runs separate and preserves the original random draws', () => {
    const draws = [0, 0.25, 0.5, 0.75, 1];
    let index = 0;
    const chunks = planTyping(`"""''`, { ...CADENCE, jitter: 0.2 }, false, () => draws[index++] ?? 0.5, 0.5);
    expect(chunks.map((chunk) => chunk.text)).toEqual(['"""', "'", "'"]);
    expect(chunks[0]?.delay).toBeCloseTo(135);
    expect(chunks[1]?.delay).toBeCloseTo(55);
    expect(chunks[2]?.delay).toBeCloseTo(60);
    expect(index).toBe(5);
  });
  it('pauses as words start, and after punctuation and opening brackets', () => {
    expect(delays('ab c(d, e')).toEqual([
      ['a', 100],
      ['b', 100],
      [' ', 100],
      ['c', 150],
      ['(', 100],
      ['d', 170],
      [',', 100],
      [' ', 130],
      ['e', 150],
    ]);
  });

  it('inserts a newline together with the following indentation, then pauses', () => {
    expect(delays('x\n  y')).toEqual([
      ['x', 100],
      ['\n  ', 100],
      ['y', 400],
    ]);
  });

  it('inserts leading indentation at once at the start of a line', () => {
    expect(delays('  x', true).map(([t]) => t)).toEqual(['  ', 'x']);
    expect(delays('  x').map(([t]) => t)).toEqual([' ', ' ', 'x']);
  });

  it('starts a line with no indentation, and a newline with none after it, with the text itself', () => {
    expect(delays('x', true).map(([t]) => t)).toEqual(['x']);
    expect(delays('x\ny').map(([t]) => t)).toEqual(['x', '\n', 'y']);
  });

  it('scales every delay for type_fast', () => {
    expect(planTyping('a b', CADENCE, /* atLineStart= */ false, Math.random, /* scale= */ 0.5).map((c) => c.delay)).toEqual([50, 50, 75]);
  });

  it('scales reading time with the character count, above a floor', () => {
    const reading = { msPerChar: 10, minMs: 10 };
    expect(readingTime('', reading)).toBe(10);
    expect(readingTime('Hi.', reading)).toBe(30);
    expect(readingTime(Array.from({ length: 100 }, () => 'word').join(' '), reading)).toBe(4990);
    expect(readingTime('word\n\n  word', reading)).toBe(90);
  });
});

it(
  'ConcatenatesToText, ChunksAreUnits: splits text into chunks that concatenate to it, each one character or a line break with its indentation',
  () => {
    let texts = [''];
    for (let n = 1; n <= 5; n++) {
      texts = [...texts, ...texts.filter((t) => t.length === n - 1).flatMap((t) => CHARS.map((c) => t + c))];
    }
    for (const text of texts) {
      for (const atLineStart of [false, true]) {
        const chunks = planTyping(text, CADENCE, atLineStart, () => 0.5);
        const at = `${JSON.stringify(text)} at line start: ${atLineStart}`;
        expect(chunks.map((c) => c.text).join(''), at).toBe(text);
        chunks.forEach((c, i) => {
          const unit = c.text.length === 1 && c.text !== '\n';
          const lineBreak = /^\n[ \t]*$/.test(c.text);
          const quotes = /^(?:"{3,}|'{3,})$/.test(c.text);
          const leading = i === 0 && atLineStart && /^[ \t]+$/.test(c.text);
          expect(unit || lineBreak || leading || quotes, `${at}: chunk ${i} ${JSON.stringify(c.text)}`).toBe(true);
          expect(c.delay, at).toBeGreaterThanOrEqual(0);
        });
      }
    }
  },
  EXHAUSTIVE_MS,
);

/** Returns the existing atomic plan for grouped-playback tests. */
function atoms(text: string) {
  return planTyping(text, CADENCE, true, () => 0.5);
}

/** Returns each grouped edit's text. */
function groups(text: string, mode: 'lines' | 'blocks'): string[] {
  return groupTyping(atoms(text), mode).map((chunk) => chunk.text);
}

describe('grouped code playback', () => {
  it('PrefixExact: groups complete lines without losing indentation or quote atoms', () => {
    expect(groups(`one\n  """two"""\nthree`, 'lines')).toEqual(['one\n  ', '"""two"""\n', 'three']);
    const text = `one\n\n  """two"""\nthree`;
    expect(groups(text, 'blocks').join('')).toBe(text);
  });

  it('BoundedGroups: limits blocks to four lines and 240 Unicode characters', () => {
    expect(groups('a\nb\nc\nd\ne', 'blocks')).toEqual(['a\nb\nc\nd\n', 'e']);
    const text = '\u{1F600}'.repeat(241);
    expect(groups(text, 'blocks').map((part) => Array.from(part).length)).toEqual([240, 1]);
  });

  it('bounds long lines by Unicode characters and prefers whitespace', () => {
    expect(groups('\u{1F600}'.repeat(241), 'lines').map((part) => Array.from(part).length)).toEqual([240, 1]);
    const line = `${'a'.repeat(200)} ${'b'.repeat(100)}`;
    expect(groups(line, 'lines')).toEqual([`${'a'.repeat(200)} `, 'b'.repeat(100)]);
    const quotes = '"'.repeat(241);
    expect(groups(`a${quotes}b`, 'lines')).toEqual(['a', quotes, 'b']);
  });

  it('prefers a blank line as a block boundary', () => {
    expect(groups('one\n\ntwo\nthree\nfour', 'blocks')).toEqual(['one\n\n', 'two\nthree\nfour']);
  });

  it('prefers whitespace when a long line crosses the size limit', () => {
    const text = `${'a'.repeat(200)} ${'b'.repeat(100)}`;
    expect(groups(text, 'blocks')).toEqual([`${'a'.repeat(200)} `, 'b'.repeat(100)]);
  });

  it('keeps an oversized atomic quote run whole and makes progress', () => {
    const quotes = '"'.repeat(241);
    expect(groups(`a${quotes}b`, 'blocks')).toEqual(['a', quotes, 'b']);
  });

  it('leaves typing unchanged and groups no empty plan', () => {
    const plan = atoms('a\n  b');
    expect(groupTyping(plan, 'typing')).toEqual(plan);
    expect(groupTyping([], 'lines')).toEqual([]);
  });
});
