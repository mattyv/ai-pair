// The relay's tool definitions on their own: what the `step` schema tells an agent about each malformed action.
// Solitary: the protocol's checks are mocks, so a test says what each answers, and sees how the schema uses it and
// what it was given; the protocol's constants and schemas stay real, as the shared library they are.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ACTION_KINDS,
  actionKinds,
  CURSOR_MARKER,
  MOVE_TARGET_SCHEMA,
  moveProblem,
  SPAN_TARGET_SCHEMA,
  spanProblem,
  speechProblem,
  typeProblem,
} from '@ai-pair/protocol';
import { TOOLS } from '../src/tools';

vi.mock(import('@ai-pair/protocol'), async (importOriginal) => ({
  ...(await importOriginal()),
  actionKinds: vi.fn(),
  moveProblem: vi.fn(),
  spanProblem: vi.fn(),
  speechProblem: vi.fn(),
  typeProblem: vi.fn(),
}));

/** The `step` tool's arguments, as the MCP server checks them. */
const STEP = z.object(TOOLS.step.inputSchema);

it('guides agents toward safe structural edits and a named file', () => {
  const schema = JSON.stringify(z.toJSONSchema(STEP, { unrepresentable: 'any' }));
  expect(schema).toContain('next_close');
  expect(schema).toContain('structural newline');
  expect(schema).toContain('Name the file before the first edit');
});

/** Returns the messages the `step` schema gives for a batch of this one action; none if it passes. */
function problems(action: unknown): string[] {
  const parsed = STEP.safeParse({ actions: [action] });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('selected narration', () => {
  it('checks flagged text and leaves unflagged narration alone', () => {
    vi.mocked(actionKinds).mockReturnValue(['say']);
    vi.mocked(speechProblem).mockReturnValue('shorten the narration');
    expect(problems({ say: 'hello', speak: true })).toEqual(['shorten the narration']);
    expect(speechProblem).toHaveBeenCalledWith('hello');
    vi.mocked(speechProblem).mockClear();
    expect(problems({ say: 'hello' })).toEqual([]);
    expect(problems({ say: 'hello', speak: false })).toEqual([]);
    expect(speechProblem).not.toHaveBeenCalled();
    vi.mocked(speechProblem).mockReturnValue(undefined);
    expect(problems({ say: 'hello', speak: true })).toEqual([]);
    expect(problems({ delete: true, speak: true })).not.toEqual([]);
  });
});

describe('a move', () => {
  it("gives the agent moveProblem's answer about a move whose fields have their types", () => {
    vi.mocked(actionKinds).mockReturnValue(['move']);
    vi.mocked(moveProblem).mockReturnValue('the move is wrong');
    expect(problems({ move: { line: 1, to: 'line_end' } })).toEqual(['the move is wrong']);
    const [place] = vi.mocked(moveProblem).mock.lastCall ?? [];
    expect(MOVE_TARGET_SCHEMA.parse(place)).toEqual({ line: 1, to: 'line_end' });
  });

  it('accepts a move moveProblem finds nothing wrong with', () => {
    vi.mocked(actionKinds).mockReturnValue(['move']);
    expect(problems({ move: { line: 1, to: 'line_end' } })).toEqual([]);
  });

  it("gives moveProblem's answer about a move whose field has the wrong type, which no variant matches", () => {
    vi.mocked(actionKinds).mockReturnValue(['move']);
    vi.mocked(moveProblem).mockReturnValue('`line` is a line number');
    expect(problems({ move: { line: '3', to: 'line_end' } })).toEqual(['`line` is a line number']);
    expect(moveProblem).toHaveBeenCalledWith({ line: '3', to: 'line_end' });
  });

  it("gives moveProblem's answer about a move with a key it doesn't take", () => {
    vi.mocked(actionKinds).mockReturnValue(['move']);
    vi.mocked(moveProblem).mockImplementation((place) => ('before' in place ? 'A spot is one text, `at`' : undefined));
    expect(problems({ move: { line: 1, before: 'x' } })).toEqual(['A spot is one text, `at`']);
    expect(moveProblem).toHaveBeenCalledWith({ line: 1, before: 'x' });
    expect(moveProblem).toHaveBeenCalledWith({ line: 1 });
  });
});

describe.each(['select', 'point'] as const)('a %s', (kind) => {
  it("gives the agent spanProblem's answer about one whose fields have their types", () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    vi.mocked(spanProblem).mockReturnValue('the span is wrong');
    expect(problems({ [kind]: { line: 1, text: 'x' } })).toEqual(['the span is wrong']);
    const [place] = vi.mocked(spanProblem).mock.lastCall ?? [];
    expect(SPAN_TARGET_SCHEMA.parse(place)).toEqual({ line: 1, text: 'x' });
  });

  it('accepts one spanProblem finds nothing wrong with', () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    expect(problems({ [kind]: { line: 1, text: 'x' } })).toEqual([]);
  });

  it("gives spanProblem's answer about one whose field has the wrong type, which no variant matches", () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    vi.mocked(spanProblem).mockReturnValue('Give the code');
    expect(problems({ [kind]: { line: 1, text: 5 } })).toEqual(['Give the code']);
    expect(spanProblem).toHaveBeenCalledWith({ line: 1, text: 5 });
  });

  it("gives spanProblem's answer about one with a key it doesn't take", () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    vi.mocked(spanProblem).mockImplementation((place) => ('near_line' in place ? 'Give `line`' : undefined));
    expect(problems({ [kind]: { text: 'x', near_line: 3 } })).toEqual(['Give `line`']);
    expect(spanProblem).toHaveBeenCalledWith({ text: 'x', near_line: 3 });
    expect(spanProblem).toHaveBeenCalledWith({ text: 'x' });
  });
});

describe.each(['type', 'type_fast'] as const)('a %s', (kind) => {
  it("gives the agent typeProblem's answer about its text, or about a value that isn't one", () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    vi.mocked(typeProblem).mockReturnValue('Mark where your cursor ends');
    expect(problems({ [kind]: 'x' })).toEqual(['Mark where your cursor ends']);
    expect(typeProblem).toHaveBeenLastCalledWith('x');
    expect(problems({ [kind]: 5 })).toEqual(['Mark where your cursor ends']);
    expect(typeProblem).toHaveBeenLastCalledWith(5);
  });

  it('forwards the CRLF cursor boundary refusal', () => {
    vi.mocked(actionKinds).mockReturnValue([kind]);
    vi.mocked(typeProblem).mockReturnValue('Place the cursor before or after the CRLF line ending, not inside it.');
    const text = `a\r${CURSOR_MARKER}\nb`;
    expect(problems({ [kind]: text })).toEqual(['Place the cursor before or after the CRLF line ending, not inside it.']);
    expect(typeProblem).toHaveBeenCalledWith(text);
  });
});

describe('what is not one action', () => {
  it('names the actions put in one object', () => {
    vi.mocked(actionKinds).mockReturnValue(['say', 'type']);
    expect(problems({ say: 'a', type: 'b' })).toEqual([
      'One action per object, got `say` and `type`: make them separate actions, in order',
    ]);
  });

  it('tells an object with no action key the keys there are', () => {
    vi.mocked(actionKinds).mockReturnValue([]);
    const keys = ACTION_KINDS.map((k) => `\`${k}\``).join(', ');
    expect(problems({ foo: 1 })).toEqual([`Not an action: each action has one of ${keys}`]);
  });

  it("leaves zod's message where it has nothing to add: a string, a `say` that isn't a text, one action with a key it doesn't take", () => {
    expect(problems('say')).toEqual(['Invalid input']);
    expect(actionKinds).not.toHaveBeenCalled();
    vi.mocked(actionKinds).mockReturnValue(['say']);
    expect(problems({ say: 3 })).toEqual(['Invalid input']);
    expect(problems({ say: 'a', extra: 1 })).toEqual(['Unrecognized key: "extra"']);
  });
});

it('accepts structural actions and rejects malformed indentation', () => {
  expect(problems({ move: { to: 'next_close' } })).toEqual([]);
  expect(problems({ newline: { indent: '  ' } })).toEqual([]);
  expect(problems({ newline: { indent: '' } })).not.toEqual([]);
  expect(problems({ newline: { indent: 'x' } })).not.toEqual([]);
  expect(problems({ newline: { indent: '  ', extra: true } })).not.toEqual([]);
});

it('accepts an explicit multi-close acknowledgment and rejects false', () => {
  vi.mocked(actionKinds).mockReturnValue(['move']);
  expect(problems({ move: { to: 'line_end', allow_multiple_closes: true } })).toEqual([]);
  expect(problems({ move: { to: 'line_end', allow_multiple_closes: false } })).not.toEqual([]);
  const input = { actions: [{ move: { to: 'line_end', allow_multiple_closes: true } }] };
  expect(STEP.parse(input)).toEqual(input);
  expect(JSON.stringify(z.toJSONSchema(STEP, { unrepresentable: 'any' }))).toContain('allow_multiple_closes');
});

it('tells the agent to select concise speech without overriding the user setting', () => {
  const schema = JSON.stringify(z.toJSONSchema(STEP, { unrepresentable: 'any' }));
  expect(schema).toContain('Select concise narration for speech');
  expect(schema).toContain('one useful say in each batch');
  expect(schema).toContain('when the programmer enables speech');
  expect(schema).not.toContain('Request local speech');
});
