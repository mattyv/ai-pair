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

## Editing safety

-   Require each editing batch to name its target file before its first edit.
    After a reported interrupted, discarded, or failed batch, retain the stronger
    existing requirement to anchor the cursor with both file and line.
-   Provide an explicit operation to create an indented line between matching
    adjacent delimiters in Python and JSON, and a separate operation to move
    past a closing delimiter. Reject ambiguous contexts, including complex
    formatted-string prefixes; agents can use literal typing when needed.
-   Advise when a line-end move crosses multiple closing delimiters. This is a
    warning, not a substitute for choosing an exact cursor position.
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
-   Guide agents to the explicit structural newline and single-close move when
    appropriate. The observed line-ending defect does not establish the cause
    of the earlier bracket incident.
-   Use explicit action validation and error reporting so malformed input cannot
    silently become a different edit.

## Local verification and installation

-   Build and verify the local extension before installing it for use. A local
    installation is distinct from publishing a release. This workspace runs in a
    VM: installing there does not install into the user's host VS Code. The host
    needs the verified VSIX installed separately with the tools currently available.
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
