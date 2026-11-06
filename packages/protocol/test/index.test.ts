// The protocol's checks of an action. moveProblem and spanProblem go over every place specs/ActionValidation.tla
// checks: each kind of value the spec names gets a concrete one, and every place built from them holds the spec's
// ASSUMEs on the code. Solitary: the modules index.ts only re-exports are mocked empty; the schemas it takes its types
// from are constants, and real.

import { describe, expect, it, vi } from 'vitest';
import { ACTION_SCHEMA } from '../src/schemas';
import { actionKinds, CURSOR_MARKER, fieldsProblem, moveProblem, spanProblem, ToolError, typeProblem } from '../src/index';

vi.mock('../src/wire', () => ({}));
vi.mock('../src/paths', () => ({}));

/** A spot: one marker, with text around it. */
const SPOT = `x${CURSOR_MARKER}`;

/** Code a span can name. */
const CODE = 'x';

/** A `line` of each kind in the spec: left out, a line number, 0, a fraction, a text. */
const LINES = [undefined, 3, 0, 1.5, '3'];

/** An `at` of each kind: left out, a spot, no marker, two markers, the marker alone, a number. */
const ATS = [undefined, SPOT, 'x', `x${CURSOR_MARKER}y${CURSOR_MARKER}`, CURSOR_MARKER, 5];

/** A `to` of each kind: left out, `line_end`, another text. */
const TOS = [undefined, 'line_end', 'next_close', 'end'];

/** A span's `text`, `from`, or `through` of each kind: left out, code, the empty text, a number. */
const CODES = [undefined, CODE, '', 5];

/** Returns the place without the fields it leaves out, as an agent sends it. */
function sent(place: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined));
}

/** Returns whether the checks accept the `line`: left out, or a line number from 1 (`LineOK` in the spec). */
function lineOK(line: unknown): boolean {
  return line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1);
}

describe('ActionValidation', () => {
  it('accepts the multiple-close acknowledgment only as true on line_end', () => {
    expect(moveProblem({ to: 'line_end', allow_multiple_closes: true })).toBeUndefined();
    const action = { move: { to: 'line_end', allow_multiple_closes: true } };
    expect(ACTION_SCHEMA.parse(action)).toEqual(action);
    for (const place of [
      { to: 'line_end', allow_multiple_closes: false },
      { to: 'line_end', allow_multiple_closes: 'yes' },
      { to: 'next_close', allow_multiple_closes: true },
      { at: SPOT, allow_multiple_closes: true },
    ]) {
      expect(moveProblem(place)).toContain('allow_multiple_closes');
    }
  });
  it('MoveExactly, NeverThrows: gives no problem exactly for a valid move, and a message for every other', () => {
    const moves = LINES.flatMap((line) =>
      ATS.flatMap((at) => TOS.flatMap((to) => [undefined, 'x'].map((before) => ({ line, at, to, before })))),
    );
    for (const { line, at, to, before } of moves) {
      const valid =
        before === undefined &&
        lineOK(line) &&
        ((at === SPOT && to === undefined) || (at === undefined && (to === 'line_end' || (to === 'next_close' && line === undefined))));
      const place = sent({ line, at, to, before });
      expect({ place, accepted: moveProblem(place) === undefined }).toEqual({ place, accepted: valid });
    }
  });

  it('SpanExactly, NeverThrows: gives no problem exactly for a valid span, and a message for every other', () => {
    const olds = [{}, { near_line: 3 }, { to: 'y' }];
    const spans = LINES.flatMap((line) =>
      CODES.flatMap((text) => CODES.flatMap((from) => CODES.flatMap((through) => olds.map((old) => ({ line, text, from, through, old }))))),
    );
    for (const { line, text, from, through, old } of spans) {
      const code =
        (text === CODE && from === undefined && through === undefined) || (text === undefined && from === CODE && through === CODE);
      const place = sent({ line, text, from, through, ...old });
      const valid = Object.keys(old).length === 0 && lineOK(line) && code;
      expect({ place, accepted: spanProblem(place) === undefined }).toEqual({ place, accepted: valid });
    }
  });
});

describe('actionKinds', () => {
  it('lists the keys that name an action, in order, and leaves out the rest', () => {
    expect(actionKinds({ say: 'hi', wait: 1, move: {} })).toEqual(['say', 'move']);
    expect(actionKinds({})).toEqual([]);
  });
});

describe('fieldsProblem', () => {
  /** A JSON `null`, as an agent could send. */
  const jsonNull: unknown = JSON.parse('null');

  it('gives no problem for an action of each kind with its own fields, nor for an object that names no action', () => {
    for (const action of [
      {},
      { say: 'hi' },
      { run: 'npm test' },
      { run: 'npm test', wait: 2 },
      { run: 'npm test', wait: undefined },
      { delete: true },
      { type: `x${CURSOR_MARKER}` },
      { move: { line: 1, to: 'line_end' } },
      { select: { text: 'x' } },
      { point: { from: 'x', through: 'y' } },
    ]) {
      expect({ action, problem: fieldsProblem(action) }).toEqual({ action, problem: undefined });
    }
  });

  it('names a field the action does not have, and what it has', () => {
    expect(fieldsProblem({ say: 'hi', loud: true })).toBe('Unknown field `loud` in a `say` action: it has `say`.');
    expect(fieldsProblem({ run: 'x', wait: 1, cwd: '/', env: {} })).toBe(
      'Unknown field `cwd`, `env` in a `run` action: it has `run`, `wait`.',
    );
  });

  it('refuses a `delete` that is not `true`, and a `wait` that is not a number', () => {
    expect(fieldsProblem({ delete: false })).toBe('`delete` is `true`: it deletes the current selection.');
    expect(fieldsProblem({ run: 'x', wait: '2' })).toBe('`wait` is a number: the seconds to wait.');
  });

  it("gives the place's own problem before a field the place does not take", () => {
    expect(fieldsProblem({ move: {} })).toBe(moveProblem({}));
    const withTo: Record<string, unknown> = { to: 'y' };
    expect(fieldsProblem({ select: { ...withTo, extra: 1 } })).toBe(spanProblem(withTo));
    expect(fieldsProblem({ move: { to: 'line_end', extra: 1 } })).toBe(
      'Unknown field `extra` in `move`: it takes `file`, `line`, `at`, `to`, `allow_multiple_closes`.',
    );
    expect(fieldsProblem({ point: { text: 'x', near: 1 } })).toBe(
      'Unknown field `near` in `point`: it takes `file`, `line`, `text`, `from`, `through`.',
    );
  });

  it('refuses a place that is not an object by name: an array, a number, JSON null', () => {
    expect(fieldsProblem({ move: [] })).toBe('`move` is an object: it takes `file`, `line`, `at`, `to`, `allow_multiple_closes`.');
    expect(fieldsProblem({ select: 5 })).toBe('`select` is an object: it takes `file`, `line`, `text`, `from`, `through`.');
    expect(fieldsProblem({ point: jsonNull })).toBe('`point` is an object: it takes `file`, `line`, `text`, `from`, `through`.');
  });
});

describe('typeProblem', () => {
  it('rejects a cursor marker between CR and LF while allowing lone CR', () => {
    expect(typeProblem(`a\r${CURSOR_MARKER}\nb`)).toContain('CRLF');
    expect(typeProblem(`a\r${CURSOR_MARKER}b`)).toBeUndefined();
  });
  it('takes one text with one marker', () => {
    expect(typeProblem(`f(${CURSOR_MARKER})`)).toBeUndefined();
  });

  it('refuses an array, a value that is not a text, and a text with no marker or more than one', () => {
    expect(typeProblem(['x'])).toBe(
      `The text to type is one text, with ${CURSOR_MARKER} where your cursor ends: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`,
    );
    expect(typeProblem(5)).toBe(`Give the text to type, with ${CURSOR_MARKER} where your cursor ends.`);
    expect(typeProblem('x')).toBe(
      `Mark where your cursor ends with ${CURSOR_MARKER}: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`,
    );
    expect(typeProblem(`${CURSOR_MARKER}x${CURSOR_MARKER}`)).toBe(
      `The text to type has 2 ${CURSOR_MARKER}, but marks one place: where your cursor ends. A literal ${CURSOR_MARKER} can't be typed.`,
    );
  });
});

describe('ToolError', () => {
  it('is an Error with its code and message', () => {
    const error = new ToolError('no_session', 'Call `start` first.');
    expect(error).toBeInstanceOf(Error);
    expect({ code: error.code, message: error.message }).toEqual({ code: 'no_session', message: 'Call `start` first.' });
  });
});

it('accepts a relative next-close move and rejects an absolute one', () => {
  expect(moveProblem({ to: 'next_close' })).toBeUndefined();
  expect(moveProblem({ to: 'next_close', line: 1 })).toBeDefined();
  expect(moveProblem({ to: 'next_close', file: 'a.py' })).toBeDefined();
});

it('validates structural newline indentation and rejects unknown fields', () => {
  expect(fieldsProblem({ newline: { indent: '\t' } })).toBeUndefined();
  const jsonNull: unknown = JSON.parse('null');
  for (const newline of [undefined, jsonNull, [], {}, { indent: '' }, { indent: 'x' }, { indent: ' ', extra: true }]) {
    expect(fieldsProblem({ newline })).toBeDefined();
  }
});
