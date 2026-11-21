// facepalm.ts's wire helpers and schemas (ai-pair#83). Solitary: pure functions and zod schemas, no collaborators.

import { expect, it } from 'vitest';
import {
  FACEPALM_CLIENT_NAME,
  FACEPALM_DELIVERY_SCHEMA,
  FACEPALM_ERROR_SCHEMA,
  FACEPALM_MAX_BEAT_MS,
  FACEPALM_MIN_BEAT_MS,
  FACEPALM_OK_SCHEMA,
  facepalmBeat,
  facepalmFeel,
  facepalmHello,
  isFacepalmName,
} from '../src/facepalm';

it('names AI Pair as "ai-pair", a name facepalm accepts', () => {
  expect(FACEPALM_CLIENT_NAME).toBe('ai-pair');
  expect(isFacepalmName(FACEPALM_CLIENT_NAME)).toBe(true);
});

it('accepts 1 to 64 of A-Za-z0-9._-, and nothing else', () => {
  expect(isFacepalmName('ai-pair')).toBe(true);
  expect(isFacepalmName('a'.repeat(64))).toBe(true);
  expect(isFacepalmName('')).toBe(false);
  expect(isFacepalmName('a'.repeat(65))).toBe(false);
  expect(isFacepalmName('ai pair')).toBe(false);
  expect(isFacepalmName('ai/pair')).toBe(false);
});

it('builds the hello line with the approved token', () => {
  expect(facepalmHello('ai-pair', 'deadbeef')).toBe('hello ai-pair deadbeef');
});

it('builds the feel line with the interpretation id and the picked feeling', () => {
  expect(facepalmFeel(7, 'agreement')).toBe('feel 7 agreement');
});

it('builds the beat line, bounded to facepalm’s 1 to 10000 millisecond window', () => {
  expect(facepalmBeat('question', 1500)).toBe('beat question 1500');
  expect(facepalmBeat('proposal', 1500.4)).toBe('beat proposal 1500');
  expect(facepalmBeat('question', 0)).toBe(`beat question ${FACEPALM_MIN_BEAT_MS}`);
  expect(facepalmBeat('question', -50)).toBe(`beat question ${FACEPALM_MIN_BEAT_MS}`);
  expect(facepalmBeat('proposal', 50_000)).toBe(`beat proposal ${FACEPALM_MAX_BEAT_MS}`);
});

it('parses an ok reply, and nothing else', () => {
  expect(FACEPALM_OK_SCHEMA.safeParse({ ok: true }).success).toBe(true);
  expect(FACEPALM_OK_SCHEMA.safeParse({ ok: false }).success).toBe(false);
  expect(FACEPALM_OK_SCHEMA.safeParse({}).success).toBe(false);
});

it('parses an error reply', () => {
  const parsed = FACEPALM_ERROR_SCHEMA.safeParse({ error: 'unknown request' });
  expect(parsed.success && parsed.data.error).toBe('unknown request');
});

it('parses a beat delivery with no interpretation yet, and one with one', () => {
  const bare = FACEPALM_DELIVERY_SCHEMA.safeParse({ readings: [], missed: 0 });
  expect(bare.success && bare.data.interpretation).toBeUndefined();

  const read = FACEPALM_DELIVERY_SCHEMA.safeParse({
    readings: [{ id: 1, summary: 'a nod', detail: {} }],
    missed: 0,
    interpretation: { id: 1, feeling: 'agreement', beat: 'question', feelings: ['agreement', 'unknown'] },
  });
  expect(read.success && read.data.interpretation?.feeling).toBe('agreement');
});

it('rejects a delivery whose interpretation names an unknown feeling or beat kind', () => {
  expect(
    FACEPALM_DELIVERY_SCHEMA.safeParse({
      readings: [],
      missed: 0,
      interpretation: { id: 1, feeling: 'furious', beat: 'question', feelings: ['furious'] },
    }).success,
  ).toBe(false);
  expect(
    FACEPALM_DELIVERY_SCHEMA.safeParse({
      readings: [],
      missed: 0,
      interpretation: { id: 1, feeling: 'agreement', beat: 'greeting', feelings: ['agreement'] },
    }).success,
  ).toBe(false);
});
