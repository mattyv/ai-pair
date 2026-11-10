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

## Follow-up: 0.18.0 host report

The programmer's latest report concerns build `0.18.0-0c4255050a0a` where
noted below. User-verified results, historical observations, and source analysis
are distinguished; historical reports have not been reproduced on this build.

| ID | Status | Report and current evidence |
|---|---|---|
| B1 | Resolved, user verified | Typing a docstring with triple quotes was previously misclassified as a programmer edit and interrupted. The programmer reports that it now passes on 0.18.0. |
| B2 | Documented behavior | `newline` indentation is relative to the current line. The contract was clarified in 0.12; use the documented relative indentation. |
| B3 | Open; verified in automated test | A programmer message interrupted typing within a token and discarded the queued batch. The current in-memory test reproduces `unknown` left as `unk`, reports `nown` as unplayed, and reports the queued batch as discarded. The historical host observation still needs a 0.18.0 host retest. |
| B4 | Open on 0.18.0-0c4255050a0a | A `run` at the end of a batch stalled, leaving the next batch waiting. The host cause remains unconfirmed; do not treat the command or subsequent batch as completed without its report. |
| B5 | Historical; retest needed | After `no_editor` and a new `start`, the programmer observed lost cursor, turn, and queue. Current code suspends a disconnected session and resumes it for the same directory; it deliberately discards queued work on disconnect. A different directory starts a new session. This does not establish what happened in the historical host incident. |
| B6 | Resolved, user verified | `newline` was refused after a dict comprehension on the same line. The programmer reports that it now works on 0.18.0. |
| B7 | Open on 0.18.0-0c4255050a0a | While the run was stalled and a later edit waited, `read` showed the queued edit although the disk did not. `read` is specified to return the projected post-queue text; its `dirty` flag describes the actual editor buffer and does not establish that projected text was applied or saved. The missing distinction in the result can make the projection look like completion evidence. |
| B8 | By design; usability feedback | A batch is restricted to one file, including a point-only explanation. The guide states the constraint; the programmer reports friction with it. |

A useful regression would hold a command open, queue a real edit, and compare
projected `read` text, the editor buffer, and disk before and after completion or
interruption. Preserve the documented projection contract while investigating
an explicit projection indicator; do not infer the cause of B4 from B7 alone.

## Follow-up: 0.18.2 development host report

The programmer's report concerns development build
`0.18.2-6fd7da7c0063` on 2026-11-07. The statuses below distinguish the
reported result from a reproduced cause.

| ID | Status | Latest evidence or next check |
|---|---|---|
| B1 | Resolved | The earlier user-verified triple-quote fix remains resolved. |
| B2 | By design | Newline indentation remains relative to the current line. |
| B3 | Open; historical host observation | The current automated test reproduces the interruption and discarded queue. The historical host event remains open. |
| B4 | Watching; host retest passed | The programmer reports that an exit-1 command returned its traceback and an exit-0 command returned its output, both promptly on 0.18.2. Keep watching for recurrence before closing the earlier stall. |
| B5 | Open; historical host observation | The reported context loss remains unconfirmed on the current build. |
| B6 | Resolved | The programmer previously verified the newline fix. |
| B7 | Watching | Retest the projected read while a command and later edit are pending, then compare completion and actual content. Close only if the distinction holds in the host retest. |
| B8 | By design | The one-file batch restriction remains documented usability feedback. |
| B9 | Open; minor | Reports label the terminal shell as `python` for some commands and `bash` for others, although every command ran in the same Bash terminal. |
| B10 | Open; unconfirmed | Interrupt during `speak` and `type` was reported as completed with all edits. It is unclear whether the work had already finished; the report has not been reproduced. |

The programmer reports that `speak: true` plays narration aloud. The 45-word
limit and the one-spoken-message-per-batch limit were enforced, and typing
appeared to wait for speech to finish. These observations do not establish
the cause of B10.

## Speech follow-ups, 2026-11-08

The programmer authorized all three planned speech increments, optional music
ducking, and the final merge to main with removal of unused local and origin
branches after required verification. Terra implements and Astra reviews.

| Request | Current checkpoint | Remaining evidence |
|---|---|---|
| Sentence pipelining | Source approved; pipeline GitHub build green; installed three-sentence Kokoro unit completed on a private null sink. | Final combined package, boundary timing and platform/device acceptance. |
| Separate listening speed | Experimental setting and local PCM worker implemented; focused and composed tests pass. | Final solitary coverage, Astra source review, package verification and listening validation. |
| Warm local worker protocol | Model and ownership contract in progress. | Reviewed model, implementation, tests and packaged reuse proof. |
| Music ducking | Private PipeWire experiments rejected shared soft-volume writes and generic loopback restoration. | A verified gain mechanism that preserves user volume and routing under failure. |
| Merge and branch cleanup | Explicitly authorized. | Required integration coverage, completed feature review and final package checks; preserve unmerged work and host-only worktrees. |

Ducking is not yet an advertised capability. The rejected experiments and their
limits are recorded in `blueprints/ideas/local-music-ducking.md`.

## Night checkpoint, 2026-11-08

Unreleased work is checkpointed for issues #24, #25 and #26. The reply timing
control is a Settings dropdown. Explicit working directories are authoritative,
and the generic diagnostic-snapshot caveat is deduplicated per session.

The exact packaged 0.21.2 relay rejects an outside-workspace directory correctly.
The reported workspace diagnostics identified an active 0.21.1 backend. A separate
isolated reproduction demonstrated that an older window can overwrite the shared
launcher with an older relay. The user's active relay version was not established.

Additional checkpoint code resets fresh-session batch numbering while preserving
resume, checks workspace/relay runtime identity, and adds an actual-launcher MCP
regression fixture. These latest combined changes are not release-approved.
Remaining work: independent runtime-guard review, combined coverage, architecture
updates for runtime identity, and a new packaged MCP green run after the version
is bumped. No new package is claimed ready by this checkpoint.

### Candidates for later discussion

-   Optional review gate after a logical code block; begin with Accept and Ask
    for changes before adding rollback or locks.
-   A review record/export of accepted changes, explanations and decisions.
-   Explicit Reject and safe rollback, preserving the programmer's edits.
-   Locks on accepted code, with deliberate reopen and formatter handling.
-   Human-selected block boundaries and review during the programmer's turn.
-   Session summary/export to help re-establish context after restart; distinguish
    tool state from the coding agent's own conversation history.
-   The separate command-ID collision after reload (#11).
-   Optional AMD Kokoro acceleration (#14), after measuring its practical benefit.
-   The deferred user-routed virtual music output and ducking design.

Chat order, line/block playback, selected narration, sentence pipelining,
listening speed, warm worker reuse, output selection and model status have
implementation already. Their older planning notes are not a new-work list.

## Independent architecture audit, 2026-11-10

Astra reviewed lifecycle-overhaul commit `d1bdaad` and the current source.
These are future work, not changes included in the speech overhaul. Evidence
comes from source inspection and in-memory probes, not a full host reproduction.

-   **Session recovery: bounded overhaul.** A malformed checkpoint passes the
    shallow validator and throws during revival (reproduced). Introduce one
    versioned, validated recovery envelope for session and history, ordered
    writes, and an explicit disposition for accepted unfinished work. Test
    malformed/legacy data, delayed/rejected writes and crashes around commit.
    Debounced durability and mismatched generations are risks; torn disk writes
    were not reproduced. See `packages/core/src/controller.ts` and the
    persistence boundary in `packages/vscode/src/extension.ts`.
-   **Report provenance: focused protocol fix.** Returning an old report can
    insert its events into a newer session (reproduced at the controller
    boundary, not through a real MCP client). Carry a controller-owned session
    epoch and delivery receipt through report/return. Test late and duplicate
    returns across end/start and reconnect, preserving legitimate cancellation
    handback. See `packages/core/src/bridge.ts`,
    `packages/core/src/controller.ts` and `packages/relay/src/server.ts`.
-   **Relay handshake ownership: focused fix.** A normal upgraded socket that
    never receives welcome remains pending after link shutdown (fake-socket
    reproduction). Own the pending socket, welcome deadline, abort and shutdown
    under one connection attempt. Test silent peers, cancellation, shutdown and
    stale completion. See `packages/relay/src/link.ts`.
-   **Command identity across reload: focused fix, related to #11.** Run IDs
    restart while history survives, allowing old rows to target a new command
    with the same number (source-level collision). Add a host epoch or
    non-reusing identity; mark unattached historical commands unavailable. Test
    restored and new rows in both history orders. See
    `packages/core/src/player.ts`, `packages/vscode/src/terminal.ts` and
    `packages/vscode/src/webview/panel.ts`.

Retain terminal pooling, intentional command continuation after interruption,
companion transport ownership and existing relay authentication. The common
verification gap is composition across reload, session and asynchronous storage
lifetimes; a general controller, terminal or panel rewrite is not justified.
