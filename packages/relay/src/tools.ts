// The MCP tool definitions: schemas and the descriptions the agent reads at the point of use.

import { z } from 'zod';
import {
  ACTION_KINDS,
  actionKinds,
  CURSOR_MARKER,
  moveProblem,
  MOVE_TARGET_SCHEMA,
  spanProblem,
  speechProblem,
  SPAN_SCHEMA,
  SPAN_TARGET_SCHEMA,
  typeProblem,
  type Action,
  type SpanTarget,
} from '@ai-pair/protocol';
import { ELLIPSIS } from '@ai-pair/core/constants';

const file = z.string().describe('Path relative to your working directory, or absolute.');
const line = z
  .number()
  .int()
  .optional()
  .describe(
    "The line exactly as an up-to-date `read` or report shows it: the one your cursor lands on, or the code starts on. Never count lines or guess: if you haven't seen the line's number since your batches last changed the lines above it, `read` first. A number you haven't been shown for that line is rejected. Omit it for your cursor's line.",
  );
const inFile = file.optional().describe("Switch to this file, only before your batch's first edit. Omit it to stay in your cursor's file.");

/** A `select`'s or `point`'s code: its text on a line, or a range. */
const spanSchema = z
  .strictObject(
    {
      ...SPAN_TARGET_SCHEMA.shape,
      file: inFile,
      line,
      text: z
        .string()
        .optional()
        .describe("The code's exact text, starting on `line`; it may go on past it. Enough of it to be unique on its line."),
      from: z.string().optional().describe('Instead of `text`, for a range: the exact text it starts with, on `line`.'),
      through: z.string().optional().describe('With `from`: the range ends with the first match of this text after `from`.'),
    },
    // zod reports unrecognized keys only on an object it matched to this schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    { error: (issue) => (issue.code === 'unrecognized_keys' ? spanProblem(issue.input as object) : undefined) },
  )
  .superRefine((span, ctx) => {
    const problem = spanProblem(span);
    if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
  })
  // A span spanProblem passed is a SpanTarget; agents are shown the fields above. Not a pipe into
  // SPAN_SCHEMA itself: a union after a pipe drops the unknown-key issue before it (zod 4.6.7).
  .pipe(z.custom<SpanTarget>((span) => SPAN_SCHEMA.safeParse(span).success));

/** The text to type, with `CURSOR_MARKER` where the cursor ends. */
const typeText = z.string({ error: (issue) => typeProblem(issue.input) }).superRefine((text, ctx) => {
  const problem = typeProblem(text);
  if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
});

/** Returns what to say about an object that holds several actions, or `undefined` for one with fewer than two. */
function combined(input: object): string | undefined {
  const kinds = actionKinds(input);
  if (kinds.length < 2) return undefined;
  return `One action per object, got ${kinds.map((k) => `\`${k}\``).join(' and ')}: make them separate actions, in order`;
}

/** Says what's wrong with an action that matches no variant, instead of zod's bare "Invalid input". */
function actionError(issue: { input?: unknown }): string | undefined {
  const input = issue.input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const kinds = actionKinds(input);
  if (kinds.length === 0) return `Not an action: each action has one of ${ACTION_KINDS.map((k) => `\`${k}\``).join(', ')}`;
  if (kinds.length > 1) return combined(input);
  // A malformed field fails on its type, before the action's own check gets to say what's wrong.
  const move: unknown = 'move' in input ? input.move : undefined;
  if (typeof move === 'object' && move !== null) return moveProblem(move);
  const span: unknown = 'select' in input ? input.select : 'point' in input ? input.point : undefined;
  if (typeof span === 'object' && span !== null) return spanProblem(span);
  if ('type' in input) return typeProblem(input.type);
  if ('type_fast' in input) return typeProblem(input.type_fast);
  return undefined;
}

/** Builds an action's schema: no unknown fields, and a clear message when two actions were put in one. */
function action<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    // zod reports unrecognized keys only on an object it matched to this schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    error: (issue) => (issue.code === 'unrecognized_keys' ? combined(issue.input as object) : undefined),
  });
}

const actionSchema = z.union(
  [
    action({
      say: z
        .string()
        .describe(
          "Narrate right before the actions it describes: what you're doing, why, and how your code does it. It's about your code and your choices, not how the language or its libraries work (unless the programmer asked to learn them). Explain the code, don't recite it. One to three sentences; `backticks` render as code. Playback pauses so the programmer can read it.",
        ),
      speech_mode: z
        .enum(['wait', 'continue'])
        .optional()
        .describe(
          'Use continue to proceed after the reading pause while speech plays; wait is the default and waits for speech too. Use wait for questions and closing remarks.',
        ),
      speak: z
        .boolean()
        .optional()
        .describe(
          'Leave this out: a say is spoken by default when the programmer has speech enabled, and playback waits for the voice. A say over 280 characters or 45 words, or with a code fence, is shown without speech. Set false to show a say without speaking it, such as text holding a secret. Set true to require speech: the batch is rejected when the text cannot be spoken.',
        ),
    }).superRefine((narration, ctx) => {
      if (narration.speak === true) {
        const problem = speechProblem(narration.say);
        if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
      }
    }),
    action({
      move: z
        .strictObject(
          {
            ...MOVE_TARGET_SCHEMA.shape,
            file: file
              .optional()
              .describe(
                "Switch to this file (created empty if it doesn't exist), only before your batch's first edit. Omit it to stay in your cursor's file.",
              ),
            line,
            at: z
              .string()
              .optional()
              .describe(
                `A spot: the exact text around it, with ${CURSOR_MARKER} where your cursor goes, e.g. \`"import { ${CURSOR_MARKER}type Context"\` for right before \`type Context\`. May span lines. Enough text to fit only one place on the line.`,
              ),
            to: z
              .enum(['line_end', 'next_close'])
              .optional()
              .describe(
                "Instead of a spot: `next_close` steps over exactly one adjacent close with no file or line; `line_end` goes to the end of the line. It steps past a close you typed only if that close is on this line. A block's closing brace, below its body, isn't on your cursor's line.",
              ),
            allow_multiple_closes: z
              .literal(true)
              .optional()
              .describe('Explicitly permit line_end to cross multiple adjacent closing brackets.'),
          },
          // zod reports unrecognized keys only on an object it matched to this schema.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          { error: (issue) => (issue.code === 'unrecognized_keys' ? moveProblem(issue.input as object) : undefined) },
        )
        .superRefine((m, ctx) => {
          const problem = moveProblem(m);
          if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
        })
        .describe(
          `Move your cursor to a spot, \`at\`: the text around it with ${CURSOR_MARKER} where your cursor goes (\`line: 3, at: "import { ${CURSOR_MARKER}type Context"\` lands right before \`type Context\`), or to the end of the line with \`to: "line_end"\`. On \`line\`, exactly: a spot that isn't on it is rejected. Without \`line\`, on your cursor's line: use \`{ to: "next_close" }\` for one adjacent closing bracket, or \`at\` to move to an exact spot after another close.`,
        ),
    }),
    action({
      select: spanSchema.describe(
        "Select code, so the programmer sees what's about to change: its `text`, starting on `line`, exactly (without `line`, your cursor's line), or a range, `from` a text on it `through` the first match of another after it. Your cursor ends at its end.",
      ),
    }),
    action({
      type: typeText.describe(
        `The text, with ${CURSOR_MARKER} where your cursor ends: all of it is typed at a human pace, then your cursor steps back to the ${CURSOR_MARKER}. Replaces the selection if there is one. Inserted literally: include newlines and indentation yourself; nothing is auto-closed. The default for anything the programmer should read. The programmer watches every keystroke, and every second they see an unclosed bracket, parenthesis, quote or block is a second of suffering for them, so close each one the moment you open it, always, however short: \`"f(${CURSOR_MARKER})"\` then \`"x${CURSOR_MARKER}"\`, never \`"f(x)${CURSOR_MARKER}"\`. Type left to right, except that whatever has a close gets its close first: when the text before ${CURSOR_MARKER} opens a bracket, a quote or a block (however the language spells it: \`{\`, \`begin\`, \`then\`, \`do\`, a tag, a block comment), what's after ${CURSOR_MARKER} is its close and nothing more. Name the file before the first edit in each batch with a \`move\`, \`select\`, or \`point\`. Fill the pair, then use \`next_close\` to cross one adjacent closing bracket, or an exact \`at\` spot for another close; \`line_end\` crosses every close remaining on the line. For Python and JSON, use the structural newline action to split an adjacent pair safely. Literal newlines remain available for other languages and contexts; include their indentation and inspect surrounding closes carefully. Nothing follows ${CURSOR_MARKER} when the text opens nothing. For literal newlines start at the end of the line above, not where code follows: that code would slide right as you type. The structural newline action intentionally splits its adjacent pair. Separate definitions with one blank line, \`"\\n\\n${ELLIPSIS}"\` at the end of the one above, and leave one newline at the end of the file.`,
      ),
    }),
    action({
      type_fast: typeText.describe(
        "Like `type`, several times faster, for text the programmer doesn't need to read: imports, config, boilerplate. Only the speed changes: closes still come first.",
      ),
    }),
    action({
      newline: z
        .strictObject({ indent: z.string().regex(/^[\t ]+$/) })
        .describe('Split an adjacent matching pair in Python or JSON code, placing the cursor on an indented new line.'),
    }),
    action({ delete: z.literal(true).describe('Delete the current selection; `select` first.') }),
    action({
      point: spanSchema.describe(
        "Highlight code without editing it or moving your cursor, to talk about it: point first, then `say` what's there. The code is given as for `select`. The programmer's view goes to the pointed code, and comes back to your cursor with your next move or edit.",
      ),
    }),
    action({
      run: z
        .string()
        .describe(
          "Run a shell command the programmer can follow in the Pair panel: tests, builds, starting the app. They can reveal its terminal. They may be asked to allow it. The exit code, the output and the terminal's shell come back in the batch's report; a nonzero exit fails the batch. Make it the last action of its batch.",
        ),
      wait: z.number().optional().describe('Seconds to wait (default 120). For a server, a few: it keeps running.'),
    }),
  ],
  { error: actionError },
) satisfies z.ZodType<Action>;

/** The MCP tools the relay offers an agent: each one's description and input schema. */
export const TOOLS = {
  start: {
    description:
      "Start a live pair programming session in the programmer's editor. Call this when the programmer asks to pair. The result includes the pairing guide: read it and follow it for the whole session. From then on, everything you do through `step` appears in their editor at a human pace, with your narration.",
    inputSchema: {
      task: z.string().optional().describe("A short description of what you'll work on, shown to the programmer."),
      cwd: z
        .string()
        .optional()
        .describe(
          'Your existing working directory as an absolute path inside an open editor workspace. If omitted, the relay discovers one from client roots or its own directory. Session paths are relative to the chosen directory.',
        ),
    },
  },
  step: {
    description: `Submit a batch of visible actions, played in the programmer's editor at a human pace. A batch is one idea: usually a \`say\` explaining what's next, then the few edits it describes. A batch works in one file: name it (in \`move\`, \`select\` or \`point\`) before its first edit, and start a new batch to switch files. Write each batch yourself, by hand: never generate batches from code you wrote out first, with a script.

Pipelined: the call queues the batch and returns once the PREVIOUS batch has finished playing, with that batch's report. So plan the next batch while this one plays. The first call returns immediately.

A batch that would fail, e.g. on text that isn't on its line, is rejected at once: nothing of it is queued, and the report says which action and why. Fix it and submit the whole batch again.

Read every report. It shows each finished batch's code as it now reads, with your cursor marked \`${CURSOR_MARKER}\`: check it's what you meant. If a batch was interrupted or failed, or the programmer said or did something, your later batches were discarded; what didn't play is listed, ready to resubmit, starting with what's left of an interrupted action. Take what happened into account and re-plan.

An empty batch waits for your queued batches without waiting for the programmer.

After a report says a batch was interrupted, discarded, or failed, your cursor is where it stopped: \`read\`, then anchor the cursor with a \`move\` or \`select\` giving both \`file\` and \`line\` before anything else at the cursor, or the batch is refused with \`unanchored\`.`,
    inputSchema: {
      actions: z.array(actionSchema).describe('Played in order.'),
    },
  },
  listen: {
    description:
      "Wait for the programmer. First collects the reports of your queued batches, then returns when the programmer does something: a message (with the code they had selected, if any), an edit of theirs, a turn change, or ending the session. Call it whenever you're done or waiting: during a session, never end your turn. A natural pause, silence, or task completion is not a request to end the session. When the task is done, send the summary as a Pair `say` via `step`, then call `listen`; do not return a final conversational answer while the session is active. The programmer decides when to pause or end. During the programmer's turn you're the navigator (only `say` and `point` work), and `listen` also returns shortly after they stop typing, so you can comment. If nothing happened in time, it says so: call it again.",
    inputSchema: {},
  },
  end: {
    description:
      'End the session only when the programmer explicitly asks to end the Pair session. Do not infer this from a natural pause, silence, or task completion. Anything still queued plays out first. Afterwards the pair tools are unavailable until the next `start`; continue the conversation normally.',
    inputSchema: {
      summary: z.string().optional().describe('One or two sentences, shown to the programmer as the closing message.'),
    },
  },
  read: {
    description:
      "Read a file as it is in the programmer's editor, including unsaved changes, and as your batches will leave it: what they'll type is already in it, even while they're still playing or queued, so its line numbers are the ones your next batch starts from. Read the part of a file you're about to work in before you move there, and copy line numbers and text from it: don't guess them. Prefer this over your own file tools during the session. Lines are numbered from 1; it says where the file ends, and whether a newline ends its last line.",
    inputSchema: {
      file,
      from_line: z.number().int().optional(),
      to_line: z.number().int().optional(),
    },
  },
  diagnostics: {
    description: 'Read a privacy-preserving diagnostic snapshot from an open editor without changing its session.',
    inputSchema: { cwd: z.string().optional().describe('Absolute directory inside the editor workspace.') },
  },
  calibrate: {
    description:
      "Start a reading speed calibration in the Pair panel with a passage of your own, when the programmer asks for one (`use the Rainbow Passage`). Give the passage as a FILE: fetch or write it with a command (curl, a script) into a file, then name that file here. Never put the text in this call, in a `type`, or in your reply, and never read the file back: the API blocks reproducing published text. The extension reads the file, stores the passage in the programmer's settings, and runs the calibration; playback is held while they read, so call `listen` and wait. Refused while a calibration is under way.",
    inputSchema: {
      title: z.string().describe("The passage's name, shown to the programmer."),
      file: file.describe("The file holding the passage's text, relative to your working directory or absolute."),
      notice: z.string().optional().describe('Shown with the passage, outside the timed text: a license notice, or where it is from.'),
    },
  },
} as const;
