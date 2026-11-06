# Decisions

This file records material product and engineering choices and their limits.
Issue discussions and working notes hold the detailed evidence and history.

## Working method

-   Use test-driven development: write meaningful failing tests, implement the
    change, and run the relevant checks.
-   GPT-6.1 Terra agents write code and tests; GPT-6 Astra agents review them.
    Resolve findings and verify the resulting changes before reporting completion.

## Conversation panel

-   Offer newest-first and oldest-first chat order, retaining newest-first as the
    default. Keep the preference in VS Code settings and expose it in the panel.
-   Show messages in their event order, including a reply immediately after the
    message it follows. History text uses the theme foreground for readability.
-   Keep the Settings dialog inside the panel at narrow widths, with padding
    around its contents and space for its close button.
-   Identify an actual playback pause in text and theme-aware color; keep
    confirmation, programmer turn, suspended, idle, and natural reading states
    distinguishable. Show active typing as Playing, while a natural reading
    pause remains a reading state. A pause stays visible while any pause reason
    remains.
-   Make the reading ring keyboard accessible: click to finish its current
    countdown, or hold to pause only that countdown until release. Bind gestures
    to their original message; preserve explicit pauses, session suspension,
    command confirmations, and the programmer's turn.
-   Place one Settings gear in the toolbar, available in idle and active states.
    Explain Your move on hover or keyboard focus only while the agent listens.

## Code playback

-   Keep Typing as the default and put the mode in its own toolbar dropdown,
    mirrored in Settings, as requested. Save the choice separately from speed;
    apply changes at the next
    typing action so an in-progress action keeps its mode.
-   Show and highlight each inserted group for a reading pause. Use the existing
    reading control for finishing or holding that pause, and the existing pace
    and reading-speed settings to scale it. Limit both Lines and Blocks to 240
    Unicode code points, and Blocks to four logical lines. Prefer line and
    whitespace boundaries; preserve atomic edits, including an indivisible edit
    that exceeds a bound. Follow the highlighted group while it is read.

## Local spoken narration

-   Speak only explicitly selected, bounded agent narration; default to off.
    Keep the written text visible, and do not replay speech from history.
-   Use independent voice speed and run speech and reading timers concurrently;
    completion waits for both. The reading control changes only the timer.
-   Run locally on supported Linux x64 glibc desktop hosts. An explicit setup
    downloads the pinned model; unsupported hosts retain text-only operation.
    CPU synthesis in a VM can be slow, and audio quality depends on the host.
-   Keep one audio unit at a time and invalidate it on reply, interruption or
    page replacement. Do not persist generated audio or narration text.

## Session diagnostics

-   Keep a bounded, in-memory history of allowlisted lifecycle metadata for
    connection, requests, pause reasons, and commands. Exclude chat, source,
    paths, command text, output, and tokens. Copy a snapshot only on an explicit
    Settings action; report clipboard failure. Values not yet observed remain
    unavailable, and timestamps and identifiers are still diagnostic metadata.
-   A fresh session replaces an old suspended display; unrelated late status
    events cannot clear an actual suspension. Explain how to reconnect in the
    same project, without claiming why a connection ended.

## Command terminals

-   Keep Pair command terminals hidden by default, with an opt-in setting and
    explicit reveal for each started command. A closed or reused terminal is
    reported unavailable rather than opening an unrelated terminal. Preserve
    command approval and captured output independently of visibility.
-   Reuse only eligible Pair-owned terminals. At session end, clean up only
    owned terminals whose shells have exited; preserve live shells, including
    those with possible background descendants. Reveal the terminal if shell
    integration is unavailable. Hidden terminals are not restored when the
    workspace is reopened; users can reveal a terminal when they need it visible.

## Editing safety

-   Require each editing batch to name its target file before its first edit.
    After a reported interrupted, discarded, or failed batch, retain the stronger
    existing requirement to anchor the cursor with both file and line.
-   Provide an explicit operation to create an indented line between matching
    adjacent delimiters in Python and JSON, and a separate operation to move
    past a closing delimiter. Reject ambiguous contexts, including complex
    formatted-string prefixes; agents can use literal typing when needed.
-   Reject a line-end move that crosses multiple adjacent closing brackets at
    preflight unless it explicitly opts in. Exact spots and the single-close
    move remain available; this narrow check is not a language parser.
-   Surface available VS Code error diagnostics as advisory information after
    edits. Language providers may be absent, late, or stale; diagnostics are not
    a parser guarantee and cannot reliably identify valid but unintended Python
    tuples. Do not reject a batch merely because diagnostics are present.
-   Check Python syntax with the system `python3`, isolated from the workspace's
    imports and startup files. Its version can differ from the project's Python;
    when it is missing or fails, report that the check was unavailable.
-   Normalize CRLF input in `type` and `type_fast` before planning chunks and
    tracking cursor positions or interrupted remainders; preserve standalone
    carriage returns. Reject a cursor marker inside a CRLF pair rather than
    splitting the line ending. Literal typing remains literal otherwise.
-   Insert runs of three or more identical quotes in one edit. Pylance can
    otherwise react to a partially entered triple quote by adding unwanted
    closing quotes. Keep the user's editor and extension settings unchanged.
-   Guide agents to the explicit structural newline and single-close move when
    appropriate. The observed line-ending defect does not establish the cause
    of the earlier bracket incident.
-   Recover after a closed formatted string containing quoted expression text
    with a bounded lexical scan. Continue refusing incomplete, mismatched, and
    unsupported nested formatted expressions; this is not a Python parser.
-   Use explicit action validation and error reporting so malformed input cannot
    silently become a different edit.

## Local verification and installation

-   Build and verify the local extension before installing it for use. A local
    installation is distinct from publishing a release. This workspace runs in a
    VM: installing there does not install into the user's host VS Code. The host
    installs the verified VSIX separately. For local development, place it in the
    shared repository folder so the host can install it directly.
-   Build a downloadable VSIX in GitHub Actions for branch pushes, pull requests,
    and manual runs. The artifact identifies its version and checked-out commit;
    installing it on the Ubuntu host is a separate manual step. This workflow does
    not publish to a marketplace or create a release.
-   Show the version compiled into the running extension bundle and a
    content-derived SHA-256 build ID for the extension and web assets in the
    Settings dialog, keeping the main panel uncluttered. The build ID changes
    with the built content; it is not a manually incremented number.
-   The VM's previously installed extension was version 0.1.0; its installed
    extension bundle lacked the current post-interruption anchor guard. This does
    not establish the host's version or what caused any particular editing incident.
