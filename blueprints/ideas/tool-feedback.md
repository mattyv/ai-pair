# Tool feedback

Track frustrations with the current tool and possible improvements.

1.  **Make chat order optional.** Newest messages at the top feel unnatural.
    Offer a setting to show newest messages at the bottom instead.
1.  **Clean up terminals.** The tool leaves terminals open all over the place.
    Reuse terminals where possible and close tool-owned terminals when they are
    no longer needed.
1.  **Make code-writing granularity optional.** Offer line-at-a-time and
    block-at-a-time playback alongside the current typing behavior.
1.  **Make pause status clearer.** It is hard to tell whether playback is paused
    or running. Consider distinct colours for these states, with a clear text
    label so the status does not depend on colour alone.
1.  **Improve message contrast.** The grey chat history is hard to read. Use
    the theme's foreground for message text so it is easier to follow.
1.  **Investigate repeated LLM formatting errors.** Later, examine why the LLM
    keeps making formatting mistakes while writing code and what would prevent
    them.

1.  **Restore pair context after restart.** Investigate preserving and restoring
    the pair conversation and session context across VS Code restarts.

## Earlier investigation: structural editing mistakes

This section records the earlier hypotheses and proposals, not the current
implementation. See the [2026-11-06 smoke audit](#2026-11-06-smoke-audit) for
the verified findings and changes.

Claude's explanation of the bracket, newline and wrong-file mistakes is a
hypothesis about that session, not a verified cause. Keep the session trace and
installed extension version when investigating it.

The source inspected at that stage showed:

-   The agent guide directs agents to put closing delimiters in first and warns
    that `line_end` moves past all the closes on a line.
-   Typing applies literal editor replacements; the player does not perform a
    structural Enter operation. A file omitted from an action falls back to the
    cursor's file, although named files prevent switching within a batch.
-   The controller already rejects unanchored batches after a reported
    interruption or discard. The wrong-file anecdote needs an exact trace and
    version to determine whether it involved an older build or a guard gap.

Consider these proposals during that investigation:

1.  Provide a precise way to step over one closing delimiter.
2.  Validate an explicit file for each batch, rather than relying on a cursor
    fallback, with a migration path for existing callers.
3.  Offer advisory language-server parse diagnostics. A trailing comma that
    makes a tuple can be syntactically valid, so type checks and tests may also
    be needed.
4.  Explore opt-in, language-aware structural newline behavior only if playback
    and rehearsal can use the same semantics.
5.  Consider a warning for `line_end` near closing delimiters, accounting for
    false positives from any heuristic.

## 2026-11-06 smoke audit

The audit checked the reported behaviors against source, tests, and isolated
native trials. It does not establish every detail of the original session.
The fixes below are in the current source and await the final 0.11.0 build.

| Claim | Verdict |
|---|---|
| 1. Extra triple quotes | Confirmed with published 0.10.0, Python 2026.10 and Pylance 2026.4.1: with auto-closing always enabled, all three normal-speed function-body trials were interrupted after three quotes became six, while the closing triple remained unplayed. With auto-closing disabled, all three completed. Pylance's single-character quote handler inserts the extra triple; the 0.11 development build completed all three with auto-closing still enabled by typing the quote run atomically. A basic native profile without Python extensions also passed. A corrected no-Pylance control with Python 2026.10 completed all three trials. |
| 2. Context after restart | Same-root resume and persisted session state pass current tests; native reconnect passed. The reported loss of the LLM's own conversation context was not reproduced or established by those checks. |
| 3. Interrupted typing | Interruption can stop within a token, report the unplayed remainder, and discard queued batches. This is the current safety contract; finishing an arbitrary action after intervention would risk further unintended edits. |
| 4. Interactive commands | Interactive prompt handling is not supported. A still-running command retains an unknown exit status; a no-output report now suggests checking the terminal without claiming a prompt was detected. |
| 5. Crossing closing brackets | `line_end` can cross multiple closes. Its former advisory arrived after later actions in the batch. The new narrow preflight guard rejects that crossing before playback unless explicitly acknowledged, with `next_close` and exact spots available as alternatives. |
| 6. Diagnostics | Pylance and environment diagnostics remain advisory and visible; they are not suppressed wholesale. They do not prove the intended meaning of syntactically valid code. |
| 7. Formatter changes | A formatter can invalidate queued edits to the file it changes, regardless of command origin. Guidance now says to use a separate run-only batch, wait for the formatter to exit, and read the files before further edits. |

Current tests also verify these useful behaviors; they do not prove every
corresponding event in the historical session:

- Reads can reflect the predicted state after queued edits.
- The unseen-line and named-file checks refuse unsafe locations and files.
- Looking away or scrolling away pauses playback.
- Reports include the agent cursor's position in the code shown.
