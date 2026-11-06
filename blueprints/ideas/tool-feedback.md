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

## Future investigation: structural editing mistakes

Claude's explanation of the bracket, newline and wrong-file mistakes is a
hypothesis about that session, not a verified cause. Keep the session trace and
installed extension version when investigating it.

The current source shows:

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
