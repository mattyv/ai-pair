// facepalm_cue.ts's beat-kind detection (#83). Solitary: a pure function over Action objects, no collaborators.

import { expect, it } from 'vitest';
import type { Action } from '@ai-pair/protocol';
import { facepalmBeatKind } from '../src/facepalm_cue';

it('marks no beat for a batch that neither asks nor edits', () => {
  const actions: Action[] = [{ move: { to: 'line_end' } }, { point: { text: 'x' } }];
  expect(facepalmBeatKind(actions)).toBeUndefined();
});

it('marks a question for a say ending in a question mark', () => {
  expect(facepalmBeatKind([{ say: 'Shall I inline this?' }])).toBe('question');
  expect(facepalmBeatKind([{ say: 'Shall I inline this? ' }])).toBe('question');
});

it('does not mark a question for a say that does not end with one', () => {
  expect(facepalmBeatKind([{ say: "I'll inline this helper next." }])).toBe(undefined);
});

it('marks a proposal for each action kind that edits code', () => {
  expect(facepalmBeatKind([{ type: 'const x = 1;' }])).toBe('proposal');
  expect(facepalmBeatKind([{ type_fast: 'import x from "y";' }])).toBe('proposal');
  expect(facepalmBeatKind([{ delete: true }])).toBe('proposal');
  expect(facepalmBeatKind([{ newline: { indent: '  ' } }])).toBe('proposal');
});

it('prefers a question over an edit in the same batch', () => {
  const actions: Action[] = [{ say: 'Should I rename this?' }, { type: 'const renamed = 1;' }];
  expect(facepalmBeatKind(actions)).toBe('question');
});

it('marks a proposal for a say with no question mark alongside an edit', () => {
  const actions: Action[] = [{ say: "Here's the fix." }, { type: 'const fixed = 1;' }];
  expect(facepalmBeatKind(actions)).toBe('proposal');
});

it('marks no beat for an empty batch', () => {
  expect(facepalmBeatKind([])).toBeUndefined();
});
