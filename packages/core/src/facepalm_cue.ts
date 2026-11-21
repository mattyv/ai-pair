// What marks a Facepalm beat: a batch that asked a question, or proposed a change (#83, item 14 of
// facepalm#61). Pure: no I/O, no state; the controller calls this on the actions a batch actually
// played, then marks the beat through `FacepalmPort`.

import type { Action, FacepalmBeatKind } from '@ai-pair/protocol';

/** The action kinds that edit code, so a batch holding one is read as proposing a change. */
const EDIT_KINDS = ['type', 'type_fast', 'delete', 'newline'] as const;

/** Returns whether `action` is a `say` whose text, trimmed, ends with a question mark. */
function isQuestion(action: Action): boolean {
  return 'say' in action && action.say.trim().endsWith('?');
}

/** Returns whether `action` is one of the kinds that edits code. */
function isEdit(action: Action): boolean {
  return EDIT_KINDS.some((kind) => kind in action);
}

/**
 * Returns what a batch's played actions mark a beat as: `question` when any of them asks one, else
 * `proposal` when any of them edits code, else `undefined` when the batch marks no beat at all.
 * A question takes priority: asking something and editing in the same batch is read as the question.
 */
export function facepalmBeatKind(playedActions: readonly Action[]): FacepalmBeatKind | undefined {
  if (playedActions.some((action) => isQuestion(action))) return 'question';
  if (playedActions.some((action) => isEdit(action))) return 'proposal';
  return undefined;
}
