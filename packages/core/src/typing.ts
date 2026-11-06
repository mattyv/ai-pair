// Typing cadence and reading time. The numbers are in timing.ts.

import type { Cadence, Reading } from './timing';

/** A piece of text inserted in one edit, after waiting `delay` ms. */
export interface Chunk {
  text: string;
  delay: number;
}

const PUNCTUATION = new Set([',', ';', ':']);
const OPEN_BRACKETS = new Set(['(', '[', '{']);
const WORD = /[\p{L}\p{N}_]/u;
const TRIPLE_QUOTE_LENGTH = 3;

function isIndent(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

/**
 * Splits text into chunks: one per character, except that a newline and the indentation after
 * it are inserted together, as an editor's auto-indent would. Indentation at the very start is
 * inserted at once too, if `atLineStart`. A run of at least three identical quotes is inserted
 * in one edit. Every delay is multiplied by `scale`.
 *
 * The rhythm: quick within words, a small pause as each word starts, and longer ones after
 * punctuation, opening brackets, and newlines.
 */
export function planTyping(text: string, cadence: Cadence, atLineStart: boolean, random: () => number, scale = 1): Chunk[] {
  const chars = Array.from(text);
  const chunks: Chunk[] = [];
  let pause = 0;
  let previous: string | undefined;
  let at = 0;

  // specs/Typing.tla, `IndentOf`.
  function takeIndent(): string {
    let indent = '';
    for (let ch = chars[at]; ch !== undefined && isIndent(ch); ch = chars[++at]) {
      indent += ch;
    }
    return indent;
  }

  // specs/Typing.tla, `Plan`: the indentation at the very start is one chunk first.
  if (atLineStart) {
    const indent = takeIndent();
    if (indent !== '') {
      chunks.push({ text: indent, delay: 0 });
      previous = ' ';
    }
  }

  // specs/Typing.tla, `Chunks`.
  for (let ch = chars[at]; ch !== undefined; ch = chars[at]) {
    at++;
    const wordStart = previous !== undefined && !WORD.test(previous) && WORD.test(ch);
    const delay = cadence.charMs * (1 + (random() * 2 - 1) * cadence.jitter) + (wordStart ? cadence.wordStartMs : 0) + pause;
    if (ch === '\n') {
      const indent = takeIndent();
      chunks.push({ text: ch + indent, delay: delay * scale });
      pause = cadence.newlineMs;
      previous = indent === '' ? '\n' : ' ';
    } else {
      chunks.push({ text: ch, delay: delay * scale });
      pause = PUNCTUATION.has(ch) ? cadence.punctuationMs : OPEN_BRACKETS.has(ch) ? cadence.openBracketMs : 0;
      previous = ch;
    }
  }
  // specs/Typing.tla, `QuoteRunsAtomic`: a triple-quote delimiter is one edit.
  // Coalesce after planning so the random draws and total cadence stay the same.
  const result: Chunk[] = [];
  let nextIndex = 0;
  for (const [index, first] of chunks.entries()) {
    if (index < nextIndex) continue;
    let end = index + 1;
    if (first.text === '"' || first.text === "'") {
      while (end < chunks.length && chunks[end]?.text === first.text) {
        end++;
      }
    }
    if (end - index >= TRIPLE_QUOTE_LENGTH) {
      const run = chunks.slice(index, end);
      result.push({ text: first.text.repeat(run.length), delay: run.reduce((sum, chunk) => sum + chunk.delay, 0) });
    } else {
      result.push(...chunks.slice(index, end));
    }
    nextIndex = end;
  }
  return result;
}

/** How code appears during a typing action. */
export type CodePlayback = 'typing' | 'lines' | 'blocks';

const BLOCK_LINES = 4;
const BLOCK_CHARS = 240;

/** Groups existing atomic edits without splitting them or changing their text. */
export function groupTyping(atoms: Chunk[], mode: CodePlayback): Chunk[] {
  if (mode === 'typing') return atoms;
  const groups: Chunk[] = [];
  let start = 0;
  while (start < atoms.length) {
    let end = start;
    let chars = 0;
    let lines = 0;
    let lineEnd = start;
    let whitespace = start;
    let lineHasContent = false;
    while (end < atoms.length) {
      // The planner produces a dense array and end is within its bounds.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- end is in the dense plan
      const atom = atoms[end]!;
      const length = Array.from(atom.text).length;
      if (end > start && chars + length > BLOCK_CHARS) break;
      chars += length;
      end++;
      if (atom.text.includes('\n')) {
        lines++;
        lineEnd = end;
        const blankBoundary = !lineHasContent && lines > 1;
        lineHasContent = false;
        if (mode === 'lines' || lines === BLOCK_LINES || blankBoundary) break;
      } else if (/\s/u.test(atom.text)) {
        whitespace = end;
      } else {
        lineHasContent = true;
      }
      if (chars >= BLOCK_CHARS) break;
    }
    // A size boundary favors a complete line, then a word boundary. Oversized
    // indivisible atoms still make progress as a group of their own.
    if (end < atoms.length && lines < BLOCK_LINES) {
      if (lineEnd > start) end = lineEnd;
      else if (whitespace > start) end = whitespace;
    }
    const group = atoms.slice(start, end);
    groups.push({ text: group.map((atom) => atom.text).join(''), delay: 0 });
    start = end;
  }
  return groups;
}

/** Returns the characters a text takes to read: runs of whitespace count as one, so indentation and line breaks do not. */
export function readingChars(text: string): number {
  return text.trim().replaceAll(/\s+/g, ' ').length;
}

/** Returns how long a say pauses: per character of its text, at least the floor, so each message gets its own time. */
export function readingTime(text: string, reading: Reading): number {
  const chars = readingChars(text);
  return Math.max(reading.minMs, chars * reading.msPerChar);
}
