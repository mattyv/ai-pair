import { z } from 'zod';
import { NAVIGATOR_COMMENTARY_SCHEMA } from './schemas';

/** The panel retains up to 400 recent events and one preceding session event. */
const MAX_REPLAY_EVENTS = 401;
const text = z.string();
const number = z.number();
const reference = z.strictObject({ file: text, line: number, endLine: number.optional() });
const turn = z.enum(['agent', 'programmer']);
const panelEvent = z.union([
  z.strictObject({
    type: z.literal('session'),
    active: z.literal(true),
    task: text.optional(),
    rules: z.array(text).optional(),
    suspended: z.literal(true).optional(),
    resumed: z.literal(true).optional(),
    costSessionGeneration: z.int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal('session'),
    active: z.literal(false),
    reason: z.enum(['agent', 'programmer', 'disconnected']),
    summary: text.optional(),
    costSessionGeneration: z.int().positive().optional(),
  }),
  z.strictObject({ type: z.literal('say'), text }),
  z.strictObject({ type: z.literal('attention'), state: z.enum(['none', 'requested', 'granted']) }),
  z.strictObject({ type: z.literal('reading'), ms: number, id: number.optional(), owner: z.literal('code').optional() }),
  z.strictObject({
    type: z.literal('state'),
    state: z.enum(['typing', 'read', 'running', 'thinking', 'absent', 'paused', 'listening', 'navigator']),
    turn,
    paused: z.boolean(),
    speechPaused: z.boolean().optional(),
    ready: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ type: z.literal('programmer'), text, ref: reference.optional() }),
  z.strictObject({ type: z.literal('turn'), to: turn, message: text.optional(), ref: reference.optional() }),
  z.strictObject({ type: z.literal('interrupt') }),
  z.strictObject({ type: z.literal('point'), file: text, line: number }),
  z.strictObject({ type: z.literal('outside'), files: z.array(text) }),
  z.strictObject({
    type: z.literal('run'),
    id: number,
    command: text,
    phase: z.enum(['confirm', 'running', 'done', 'declined', 'background', 'exited']),
    exitCode: number.optional(),
  }),
]);
const calibration = z.union([
  z.strictObject({ phase: z.literal('idle') }),
  z.strictObject({ phase: z.literal('armed'), title: text }),
  z.strictObject({ phase: z.literal('reading'), title: text, text, notice: text.optional() }),
  z.strictObject({ phase: z.literal('done'), msPerChar: number, wordsPerMinute: number }),
]);

/** Validates visible workspace updates, excluding speech settings, secrets, and audio. */
export const localPanelUpdate = z.union([
  ...panelEvent.options,
  z
    .strictObject({
      type: z.literal('replay'),
      events: z.array(panelEvent).max(MAX_REPLAY_EVENTS),
      costSessionGeneration: z.int().positive().optional(),
      costSessionActive: z.boolean().optional(),
    })
    .refine((value) => (value.costSessionGeneration === undefined) === (value.costSessionActive === undefined)),
  z.strictObject({ type: z.literal('selection'), ref: reference.optional() }),
  z.strictObject({ type: z.literal('focusReply') }),
  z.strictObject({ type: z.literal('replyBehavior'), value: z.enum(['interrupt', 'finishAction']) }),
  z.strictObject({ type: z.literal('navigatorCommentary'), value: NAVIGATOR_COMMENTARY_SCHEMA }),
  z.strictObject({ type: z.literal('chatOrder'), value: z.enum(['newestFirst', 'oldestFirst']) }),
  z.strictObject({ type: z.literal('showTerminals'), value: z.boolean() }),
  z.strictObject({ type: z.literal('commandApprovalSound'), value: z.boolean() }),
  z.strictObject({
    type: z.literal('commandApprovals'),
    all: z.boolean(),
    count: z.int().nonnegative(),
    confirmationRequired: z.boolean(),
  }),
  z.strictObject({ type: z.literal('speed'), value: number }),
  z.strictObject({ type: z.literal('readingSpeed'), value: number }),
  z.strictObject({ type: z.literal('codePlayback'), value: z.enum(['typing', 'lines', 'blocks']) }),
  z.strictObject({ type: z.literal('calibration'), view: calibration }),
  z.strictObject({ type: z.literal('canStart'), value: z.boolean() }),
  z.strictObject({ type: z.literal('startEnded') }),
  z.strictObject({ type: z.literal('timings'), tipDelayMs: number, tipWarmMs: number }),
]);

/** A validated visible update for the UI-local panel. */
export type LocalPanelUpdate = z.infer<typeof localPanelUpdate>;
