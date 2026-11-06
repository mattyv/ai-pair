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

1.  **Explore selective spoken narration.** Consider text-to-speech for selected
    AI Pair MCP narration while keeping the same message visible in the panel.
    Do not speak all chat automatically; explore how the user chooses it.
    The connected coding agent selects narration through Pair MCP, while local
    Kokoro speech generates audio. No additional agent session or API key
    is needed for this design. Consider an optional `speak: true` flag
    on narration, with voice, speed and automatic speech controls in Settings.
    Audition [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) and measure
    startup latency and CPU use on the Ubuntu host.
    Replying should stop playback; stale narration should not accumulate.
    Speech must not approve commands or advance the reading countdown.
    Speech-to-text is deferred; keep this proposal focused on spoken narration.
    These are design candidates, not implemented features.

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
The 0.11.0 fixes shipped; the current 0.12.0 work adds quiet terminals and
clarifies the relative indentation contract.

| Claim | Verdict |
|---|---|
| 1. Extra triple quotes | Confirmed with published 0.10.0, Python 2026.10 and Pylance 2026.4.1: with auto-closing always enabled, all three normal-speed function-body trials were interrupted after three quotes became six, while the closing triple remained unplayed. With auto-closing disabled, all three completed. Pylance's single-character quote handler inserts the extra triple; the 0.11 development build completed all three with auto-closing still enabled by typing the quote run atomically. A basic native profile without Python extensions also passed. A corrected no-Pylance control with Python 2026.10 completed all three trials. |
| 2. Context after restart | Same-root resume and persisted session state pass current tests; native reconnect passed. The reported loss of the LLM's own conversation context was not reproduced or established by those checks. A host screenshot showed the panel suspended; source associates that state with a disconnected or restored session, but does not establish why it occurred. See the command-hang evidence below. |
| 3. Interrupted typing | Reproduced by design: Send can interrupt within a token and report the exact unplayed remainder. Explore an explicit send-after-this-action option later, with urgent Stop and editor changes still interrupting immediately. Do not silently finish an unbounded action. |
| 4. Interactive commands | The reported host hang remains unresolved. Host evidence shows Bash using `/snap/code/276/.../shellIntegration-bash.sh`, Rich integration, sequences P A B E C D, and an empty prompt. In our separate native environment, shell-integrated checks returned promptly for completed and still-running commands; a no-integration control returned an unknown outcome. The host screenshot also showed a suspended session, which is connection or restore evidence rather than proof of a terminal cause; see claim 2. These checks do not establish the host cause. Interactive prompt handling is not supported. |
| 5. Crossing closing brackets | `line_end` can cross multiple closes. Its former advisory arrived after later actions in the batch. The new narrow preflight guard rejects that crossing before playback unless explicitly acknowledged, with `next_close` and exact spots available as alternatives. |
| 6. Diagnostics | Pylance and environment diagnostics remain advisory and visible; they are not suppressed wholesale. They do not prove the intended meaning of syntactically valid code. |
| 7. Formatter changes | A formatter can invalidate queued edits to the file it changes, regardless of command origin. Guidance now says to use a separate run-only batch, wait for the formatter to exit, and read the files before further edits. |

Current tests also verify these useful behaviors; they do not prove every
corresponding event in the historical session:

- Reads can reflect the predicted state after queued edits.
- The unseen-line and named-file checks refuse unsafe locations and files.
- Looking away or scrolling away pauses playback.
- Reports include the agent cursor's position in the code shown.

## Follow-up: structural indentation

The newline action adds its requested indentation to the current line's leading
indentation. This is by design and is covered by unit and end-to-end tests;
the agent guide now spells it out with an example. The report does not establish
an editor on-enter action or formatter as the cause.

## Listening status feedback

A host screenshot showed Your move while the agent's `listen` call was waiting
after an informational message, and the agent continued after a long pause. The
label can imply that a reply is required even when no question was asked. Clarify
that replying is optional and the agent may continue after waiting; do not infer
a disconnection from this status.
