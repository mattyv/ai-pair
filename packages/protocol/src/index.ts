// Types of the agent-facing protocol. See PROTOCOL.md.

import type { MoveTarget, SpanFields, ToolErrorCode } from './schemas';

/**
 * Marks the agent cursor: in a report's code, where a spot puts it, and where a `type` leaves it.
 * Spans ignore it, so code can be copied from a report as is.
 */
export const CURSOR_MARKER = '\u{258C}';

/** The keys that name an action. An action object has exactly one of them. */
export const ACTION_KINDS = ['say', 'move', 'select', 'type', 'type_fast', 'newline', 'delete', 'point', 'run'] as const;

/** The fields a `move` takes. */
const MOVE_FIELDS = ['file', 'line', 'at', 'to', 'allow_multiple_closes'];

/** The fields a `select` or `point` takes. */
const SPAN_FIELDS = ['file', 'line', 'text', 'from', 'through'];

/** An object as it arrived, before its schema checked it: each field of `T` may be there, with any value. */
export type Unchecked<T> = { [K in keyof T]?: unknown };

/** Returns the fields as a comma-separated list of code spans. */
function fieldList(fields: string[]): string {
  return fields.map((f) => `\`${f}\``).join(', ');
}

/** Returns what's wrong with a place's `line`, if anything (specs/ActionValidation.tla, `LineOK`). */
function lineProblem(line: unknown): string | undefined {
  if (line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1)) return undefined;
  return "`line` is a line number, from 1, exactly as your latest `read` or report shows it. Omit it for your cursor's line.";
}

/** Returns how many cursor markers the text has. */
function markerCount(text: string): number {
  return text.split(CURSOR_MARKER).length - 1;
}

/**
 * Returns what's wrong with a spot's `at`, if anything: it needs exactly one cursor marker, and text around it
 * (specs/ActionValidation.tla, `SpotProblem`).
 */
function spotProblem(at: string): string | undefined {
  const markers = markerCount(at);
  if (markers === 0) {
    return `\`at\` marks where your cursor goes with ${CURSOR_MARKER}, e.g. \`at: "import { ${CURSOR_MARKER}type Context"\`.`;
  }
  if (markers > 1) {
    return `\`at\` has ${markers} ${CURSOR_MARKER}, but marks one spot: only where your cursor goes. Text copied from a report may carry the cursor's old ${CURSOR_MARKER}; leave that one out.`;
  }
  if (at === CURSOR_MARKER) return `\`at\` needs text around ${CURSOR_MARKER}, to find the spot by.`;
  return undefined;
}

/** Returns what's wrong with a `move`'s combination of fields, if anything (specs/ActionValidation.tla, `MoveProblem`). */
export function moveProblem(target: Unchecked<MoveTarget>): string | undefined {
  if ('before' in target || 'after' in target) {
    return `A spot is one text, \`at\`: the text around it, with ${CURSOR_MARKER} where your cursor goes, e.g. \`at: "import { ${CURSOR_MARKER}type Context"\`.`;
  }
  const line = lineProblem(target.line);
  if (line !== undefined) return line;
  if (target.to !== undefined && target.to !== 'line_end' && target.to !== 'next_close') return '`to` is `"line_end"` or `"next_close"`.';
  if (target.allow_multiple_closes !== undefined && (target.allow_multiple_closes !== true || target.to !== 'line_end')) {
    return '`allow_multiple_closes` may only be `true` with `to: "line_end"`.';
  }
  if (target.to === 'next_close' && (target.line !== undefined || target.file !== undefined)) {
    return '`next_close` acts at the current cursor: omit `file` and `line`.';
  }
  if (target.at !== undefined && target.to !== undefined) return 'Give one place on the line: `at`, or `to: "line_end"`, not both.';
  if (target.at === undefined && target.to === undefined) return 'Give the place on the line: `at`, or `to: "line_end"`.';
  // specs/ActionValidation.tla, `CheckAtText`: an `at` that isn't a text gets a message; `spotProblem` would throw on it.
  if (target.at !== undefined) {
    return typeof target.at === 'string' ? spotProblem(target.at) : `\`at\` is a text, with ${CURSOR_MARKER} where your cursor goes.`;
  }
  return undefined;
}

/** Returns what's wrong with a `select`'s or `point`'s combination of fields, if anything (specs/ActionValidation.tla, `SpanProblem`). */
export function spanProblem(span: Unchecked<SpanFields>): string | undefined {
  if ('near_line' in span) return 'Give `line`: the line the code starts on, exactly as your latest `read` or report shows it.';
  if ('to' in span) return 'The end of a range is `through`: `from` and `through` are both texts.';
  const line = lineProblem(span.line);
  if (line !== undefined) return line;
  const range = span.from !== undefined || span.through !== undefined;
  if (span.text !== undefined && range) return 'Give `text`, or `from` and `through`, not both.';
  if (range && (typeof span.from !== 'string' || typeof span.through !== 'string')) {
    return 'A range is `from` and `through`, both texts: from the start of `from` through the end of the first `through` after it.';
  }
  if (!range && typeof span.text !== 'string') return 'Give the code: `text`, or `from` and `through`.';
  if (span.text === '' || span.from === '' || span.through === '') return "The code's text can't be empty.";
  return undefined;
}

/** Returns the action keys an object has; more than one means actions were combined by mistake. */
export function actionKinds(value: object): string[] {
  return Object.keys(value).filter((k) => (ACTION_KINDS as readonly string[]).includes(k));
}

/** Largest selected narration, counted as Unicode code points. */
const MAX_SPEECH_CHARACTERS = 280;
/** Largest selected narration, counted as whitespace-delimited words. */
const MAX_SPEECH_WORDS = 45;

/** Returns why text cannot be used as a selected spoken unit. */
export function speechProblem(text: unknown): string | undefined {
  const guidance =
    'A spoken `say` must be plain, nonempty text of at most 280 Unicode characters and 45 words. Shorten it, or leave `speak` out to show it without speech.';
  if (typeof text !== 'string') return guidance;
  const trimmed = text.trim();
  const characters = Array.from(text).length;
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
  if (trimmed === '' || text.includes('```') || text.includes('~~~') || characters > MAX_SPEECH_CHARACTERS || words > MAX_SPEECH_WORDS) {
    return `${guidance} Received: ${words}/${MAX_SPEECH_WORDS} words, ${characters}/${MAX_SPEECH_CHARACTERS} Unicode characters.`;
  }
  return undefined;
}

/**
 * Reports whether an action is a `say` that is spoken: every `say` is, unless it opts out with
 * `speak: false` or its text cannot be spoken, in which case it is shown only (#41).
 */
export function spokenSay(action: unknown): boolean {
  // specs/ActionValidation.tla, Spoken: opting out and unspeakable text both leave the message shown only.
  if (typeof action !== 'object' || action === null || !('say' in action)) return false;
  return !('speak' in action && action.speak === false) && speechProblem(action.say) === undefined;
}

/**
 * Returns what's wrong with an action's fields, if anything: the fields the relay's schema allows, a
 * `delete` that is `true`, and a `wait` that is a number. The player checks this too, so an action
 * that skipped the schema is held to it all the same (#45).
 */
export function fieldsProblem(action: object): string | undefined {
  const kind = actionKinds(action)[0];
  if (kind === undefined) return undefined;
  const allowed = kind === 'run' ? ['run', 'wait'] : kind === 'say' ? ['say', 'speak', 'speech_mode', 'speech_delivery'] : [kind];
  const extra = Object.keys(action).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return `Unknown field ${fieldList(extra)} in a \`${kind}\` action: it has ${fieldList(allowed)}.`;
  if ('speech_mode' in action && action.speech_mode !== undefined && action.speech_mode !== 'wait' && action.speech_mode !== 'continue') {
    return '`speech_mode` must be `wait` or `continue`.';
  }
  if (
    'speech_delivery' in action &&
    action.speech_delivery !== undefined &&
    (typeof action.speech_delivery !== 'string' || !['neutral', 'curious', 'excited', 'whispering'].includes(action.speech_delivery))
  ) {
    return '`speech_delivery` must be `neutral`, `curious`, `excited`, or `whispering`.';
  }
  if ('speak' in action && action.speak !== undefined && typeof action.speak !== 'boolean') {
    return '`speak` must be a boolean.';
  }
  if ('say' in action && 'speak' in action && action.speak === true) {
    const problem = speechProblem(action.say);
    if (problem !== undefined) return problem;
  }
  if ('newline' in action) {
    const value = action.newline;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('indent' in value) ||
      typeof value.indent !== 'string' ||
      !/^[\t ]+$/.test(value.indent) ||
      Object.keys(value).some((key) => key !== 'indent')
    ) {
      return '`newline` takes a nonempty `indent` of spaces or tabs.';
    }
  }
  if ('delete' in action && action.delete !== true) return '`delete` is `true`: it deletes the current selection.';
  if ('wait' in action && action.wait !== undefined && typeof action.wait !== 'number') return '`wait` is a number: the seconds to wait.';
  const place: unknown = 'move' in action ? action.move : 'select' in action ? action.select : 'point' in action ? action.point : undefined;
  const fields = kind === 'move' ? MOVE_FIELDS : SPAN_FIELDS;
  if (typeof place === 'object' && place !== null && !Array.isArray(place)) {
    // The place's own check first: it knows what a mistaken field was meant to be.
    const problem = kind === 'move' ? moveProblem(place) : spanProblem(place);
    if (problem !== undefined) return problem;
    const unknown = Object.keys(place).filter((k) => !fields.includes(k));
    if (unknown.length > 0) return `Unknown field ${fieldList(unknown)} in \`${kind}\`: it takes ${fieldList(fields)}.`;
  } else if (kind === 'move' || kind === 'select' || kind === 'point') {
    return `\`${kind}\` is an object: it takes ${fieldList(fields)}.`;
  }
  return undefined;
}

/** Returns what's wrong with the text of a `type`, if anything: it marks where the cursor ends with one `CURSOR_MARKER`. */
export function typeProblem(text: unknown): string | undefined {
  if (Array.isArray(text)) {
    return `The text to type is one text, with ${CURSOR_MARKER} where your cursor ends: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`;
  }
  if (typeof text !== 'string') return `Give the text to type, with ${CURSOR_MARKER} where your cursor ends.`;
  const markers = markerCount(text);
  if (markers === 0) {
    return `Mark where your cursor ends with ${CURSOR_MARKER}: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`;
  }
  if (markers > 1) {
    return `The text to type has ${markers} ${CURSOR_MARKER}, but marks one place: where your cursor ends. A literal ${CURSOR_MARKER} can't be typed.`;
  }
  // specs/TypingEol.tla, NoSplitCRLF: a cursor cannot divide a CRLF line ending.
  if (text.includes(`\r${CURSOR_MARKER}\n`)) return 'Place the cursor before or after the CRLF line ending, not inside it.';
  return undefined;
}

/** A refused tool call, with its code. */
export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export * from './wire';
export * from './paths';
export * from './schemas';
export * from './local_audio';
export * from './panel_action';
export * from './panel_update';
export * from './panel_chunks';
export * from './command_channel';
export * from './local_diagnostics';

export * from './gpu_diagnostics';

export * from './diagnostics';

export * from './openrouter';
export * from './speech_decode';
