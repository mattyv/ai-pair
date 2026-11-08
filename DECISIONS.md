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

## Spoken narration

-   Share one output choice between Kokoro and ElevenLabs. System default keeps
    the existing VS Code webview path. An explicit local Linux override uses a
    verified PipeWire player because VS Code's webview blocks speaker selection.
-   Stage a pinned Linux x64 libstdc++ beside ONNX Runtime's binding. Its
    `$ORIGIN` search path then supplies a library compatible with the older
    Snap base without changing VS Code's environment or worker lifecycle.
    Do not request microphone permission or change the workbench iframe policy.
-   Discover local PipeWire sinks with bounded `pw-dump` calls, without requiring
    the PulseAudio compatibility tools. Refuse an explicit `PIPEWIRE_REMOTE`
    because its locality is not established. Discover outputs on refresh and
    before each explicit native speech unit. Keep a missing saved choice
    visible, and reject an unavailable native route before synthesis. Store
    stable native names locally without Settings Sync; exclude names and device
    identifiers from diagnostics. Selection stops current speech immediately.
-   Snapshot the route for each unit. Keep process ownership until close, reject
    stale callbacks, and stop rather than fall back when the chosen output
    disappears. Native pause stops the client; already-buffered audio can finish
    briefly. Stop and parent-death cleanup must also work while paused.
-   Have the agent proactively select useful, bounded narration for speech; do
    not read every message. Playback remains off by default and follows the
    programmer's provider and speech setting. Keep text visible when disabled
    or unavailable, and do not replay speech from history.
-   Use independent voice speed and run speech and reading timers concurrently;
    completion waits for both. The reading control changes only the timer.
-   Run locally on supported Linux x64 glibc desktop hosts. An explicit setup
    downloads the pinned model; unsupported hosts retain text-only operation.
    CPU synthesis in a VM can be slow, and audio quality depends on the host.
-   Keep one audio unit at a time and invalidate it on reply, interruption or
    page replacement. Do not persist generated audio or a separate speech
    transcript; visible text follows normal session history behavior.
-   Ship an AI Pair-owned bridge in the VSIX; explicit speech setup downloads
    and verifies a pinned phonemizer executable and license alongside the
    model. The embedded eSpeak NG revision in that upstream executable is not
    identified by its published package. This delivery choice does not establish
    corresponding source provenance or certify license compliance.
-   Keep Kokoro as the default. Offer ElevenLabs only through an explicit,
    application-scoped provider choice with a cloud and account-credit notice.
    Saving a key does not enable speech, change providers or play a preview.
    Never switch providers automatically after a failure.
-   Store the ElevenLabs API key only in VS Code SecretStorage, entered through
    a native masked prompt. The panel, preferences, session history and
    diagnostics receive no key. Removing or replacing it cancels cloud work and
    invalidates the voice catalog.
-   Fetch account voices instead of hard-coding a default voice or promising
    free eligibility. Preview checks whether the chosen voice works for that
    account. Free plans have credit and voice-access limits; a new account may
    have no usable API voices.
-   Send the exact selected text to the fixed ElevenLabs HTTPS API with
    Multilingual v2 and 24 kHz PCM output. Keep cloud voice speeds at 0.75, 1
    and 1.2, independently of code pace and reading speed. Preserve local voice
    settings. No extra LLM, transcript context or project data is sent.
-   Bound each cloud synthesis to 20 seconds and 40 seconds of audio; append the
    same 600 ms thinking interval used locally. Use no automatic retry or audio
    backlog. Cancellation stops local playback and aborts the request; it
    cannot promise cancellation of remote work or a credit refund. Cloud errors
    resolve only the speech gate and leave written narration available.
-   Keep initial cloud support on local desktop extension hosts. It does not
    require Kokoro's Linux runtime; remote and web hosts remain unavailable.
-   Investigate optional Kokoro GPU acceleration separately from the ElevenLabs
    integration. The user's target is Ubuntu with AMD Radeon or integrated AMD
    graphics; its exact GPU model is not yet known. The shipped engine explicitly
    selects CPU. Standard ONNX Runtime Node binaries do not provide AMD GPU
    acceleration, so a GPU setting must not claim support before a compatible
    runtime and end-to-end hardware test exist. Keep CPU available and show the
    actual execution device. See the
    [Node runtime support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
    and [AMD execution provider](https://onnxruntime.ai/docs/execution-providers/MIGraphX-ExecutionProvider.html).

## Session diagnostics

-   Record bounded speech capability, button dispatch and result events even
    without a pairing session. Keep failure reasons in a fixed allowlist;
    exclude API keys, narration, audio, voice identifiers and raw provider
    responses. Empty catalogs and blocked actions must have visible feedback.
-   Use the current in-memory speech choice immediately, while configuration
    persistence completes asynchronously. Older write completions and settings
    callbacks must not restore an earlier selection. Report persistence errors
    rather than silently accepting a different provider for the next action.
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

-   Keep remote workspace editing separate from local audio. An optional UI
    companion owns the panel, speech settings, credentials and device access;
    the workspace extension retains the controller, editor and command execution.
    Exchange bounded, versioned messages through fixed VS Code commands. Keep
    separate monotonic sequence numbers for each direction and invalidate old
    connection, job and page identities on reconnect.
-   Select the panel owner once per window using a prepare/commit handshake.
    Preparation cannot register a provider. After committing to the companion,
    a lost acknowledgement cannot cause a second legacy provider to register.
    Without a companion, retain the existing local experience; remote speech
    remains unavailable rather than playing on the workspace machine.
-   Reserve and validate a concrete local endpoint before synthesis, including
    resolving System default for that narration unit. Recheck and open that
    endpoint at playback; do not substitute another device. Removal after a
    provider request can still consume provider credits even if playback fails.
-   Share the adapter lifecycle across PipeWire, CoreAudio and WASAPI. Retain
    physical ownership until cleanup or process exit is confirmed, including
    cancellation during admission and while paused. Handle local interruption
    before forwarding its workspace action; an expired connection lease stops
    speech locally without waiting for the remote host.
-   Package native helpers in CI for macOS Intel/Apple Silicon and Windows
    x64/ARM64, preserving the existing Linux PipeWire path. Cross-compilation
    proves build compatibility; it does not establish device routing or audible
    playback. Cross-platform output support does not expand the supported
    Kokoro synthesis runtime automatically.
-   After local audio placement is verified, evaluate one-sentence lookahead
    within an admitted narration unit, separate synthesis and pitch-preserving
    playback speed, and a common warm-worker protocol. Preserve selected text,
    independent reading pace and the speech on/off setting. Avoid speculative
    synthesis of future cloud narration and dropping explanations to catch up.

-   Normalize Archi 1.5.1 exports deterministically for repository formatting and
    ASCII checks. Preserve Unicode values with context-specific JSON,
    JavaScript, CSS and HTML escapes. This formats generated exports; it is not
    a general HTML sanitizer. Verify generator replay, idempotence, embedded
    script semantics and browser rendering before publishing Pages.
-   Preserve the bundled libstdc++ runtime and its original legal notice byte
    for byte. Exclude only that exact binary from the ASCII text check; permit
    only U+FEFF and U+00A9 in its exact copyright-notice path. Neighboring
    source and vendor files remain subject to the normal ASCII checks. The
    runtime-staging test also verifies the library's pinned SHA-256.
-   Pin the verified TLA+ release asset by immutable asset ID and SHA-256,
    and fail on HTTP errors. A future deletion must fail rather than execute
    different bytes. Updating the pin requires verified upstream provenance.
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

## Deferred replies, 2026-11-08

-   Keep immediate replies as the default. The optional action-boundary reply
    waits for the current action to finish before stopping later work and
    delivering the message. Stop, edits, turn changes and session end remain
    immediate and preserve queued replies. A long-running or blocked action can
    therefore delay a deferred reply until it ends or the programmer stops it.

## Model status, 2026-11-08

-   Show the model's fixed local path, upstream revision and source in speech
    settings. Verify every pinned asset with the installer's existing size and
    SHA-256 checks before labeling it verified. A directory may exist but fail
    verification; an inaccessible directory has unknown download status. The
    result describes the last check and does not promise later file integrity.

## Speech follow-up implementation, 2026-11-08

-   Implement the authorized speech improvements in order: bounded Kokoro
    sentence pipelining, independent pitch-preserving listening speed, then a
    common warm local-synthesis worker protocol. Preserve the existing reading
    countdown, code pace, speech switch and one admitted narration unit. Keep
    ElevenLabs on one request per unit in the first increment.
-   Treat optional music ducking as a separate local-host feature. Its planned
    settings include an enable switch and attenuation level. Restore affected
    streams on speech pause, completion, cancellation and failure, without
    overwriting a concurrent user volume change. Capability and crash-recovery
    behavior require platform-specific verification before claiming support.
-   Keep the reviewed cross-platform audio checkpoint separate from these new
    features. Its legacy editor scenarios pass, but 31 integration coverage
    thresholds remain below their floors. This is an outstanding merge gate;
    development installers do not establish release readiness.

-   Separate experimental listening speed from each provider's synthesis speed.
    Snapshot the listening rate per narration; setting changes apply to the
    next unit. Rate 1.0 preserves the waveform bytes. Apply local PCM processing
    in a dedicated worker before the one fixed final thinking tail, using the
    actual resulting duration for output bounds. No extra cloud request is
    needed. Offline corpus metrics complement, but do not replace, listening
    validation.

## Speech increments 2 and 3 and the ducking decision, 2026-11-08

-   Implement listening speed as a local overlap-add stretch with
    correlation-aligned frames, a final frame anchored at the exact output end,
    and a re-placement around an isolated transient in any source gap the
    aligned frames skip. Inputs under 3,072 samples (about 128 ms) are returned
    unchanged: they are within one analysis window of every target length, and
    real parts are whole sentences. Exact lengths and no sample loss at the
    anchor are tested with impulse sweeps; this is not a claim of speech
    quality. The offered rates (0.75, 1.25, 1.5) stay labeled experimental until
    people have listened to both voices. The transform runs in a one-shot worker
    that is terminated after each result; cancellation is that termination, so
    no cooperative cancellation callback exists in the DSP.
-   A narration whose listening rate is not 1 is refused with the usual "still
    finishing" message while the previous transform worker has not exited.
    Units at rate 1 are not delayed by a retiring transform worker.
-   Move the local Kokoro worker lifecycle into one client over a strict,
    versioned protocol (init, ready with capabilities, synthesize, result,
    failure, shutdown) that carries epoch, unit and part. The worker still runs
    in a Node worker thread; the protocol is transport neutral but no second
    transport or engine was added. Behavior changes: a malformed or oversized
    worker result now retires the worker (the shipped engine cannot produce one,
    so it means the worker is not the shipped code), and a host synthesis error
    shows one fixed message instead of free worker text. A retired worker holds
    its slot until its actual exit event; if the platform never reports exit, new
    narrations are refused until the window reloads, where the old code reopened
    when termination settled. This follows the approved model, which assumes a
    fair exit.
-   Do not ship music ducking in this release. A private PipeWire study
    (loopback virtual sink, unique sink name, playback following the default
    sink, ducking by the loopback's own volume) kept stream volume, mute and
    balance exactly, multiplied independently with user volume (0.3 x 0.216 for
    a 60 percent Pulse volume), failed open when the helper was killed and
    ignored explicitly routed streams. It also showed what is not acceptable
    yet: moving a stream makes WirePlumber persist a routing target in the
    user's state, a crash leaves stale entries (inert only with unique names),
    the user's own concurrent move can be overridden in a window of
    milliseconds with no atomic compare-and-move, audible glitches on move
    were not measured, the follow-up subscribe loop was never built, and stock
    distribution configuration, real hardware, Pulse-only servers, macOS and
    Windows are untested or have no mechanism. Narration must never depend on
    ducking, so the feature stays deferred rather than shipping a setting that
    may change the user's routing. Evidence summary:
    `blueprints/ideas/local-music-ducking.md`.
-   Delegated implementation used Claude Code (`claude -p`): Sonnet workers with
    exclusive file ownership wrote code and tests, Fable reviewed the models and
    sources before they were committed. Reviewer approvals are recorded in the
    commit history and PR; they are not proofs of listening quality.
-   Verify the warm worker with the real Kokoro model, not only fakes. A run of
    the real client, worker bundle and cached model (no audio device) showed a
    455-581 ms cold load, about 2 s per sentence part, a warm second unit with
    another voice on the same worker, refusal of an overlapping request, a
    canceled inference that kept the worker owned for its remaining 2 s before
    the worker was reused, and a retired worker that held its slot until its
    exit event. It also found a defect the mocked tests could not: the pinned
    phonemizer bridge reads `workerData.modelPath`, which the refactor had
    dropped. The client now hands the checked model directory to the transport,
    and a test pins the Node worker's `workerData`. Real-speech tempo output
    had exactly the expected lengths at 0.75, 1.25 and 1.5, kept the sample
    peak at 0.75 and 1.25 but lost about 19 percent of it at 1.5, and moved a
    pitch estimate at one position from 140 to 170 Hz at 1.5 where the content
    at that position also differs; this is an automated sanity check, not
    listening validation, and it is one more reason the control stays labeled
    experimental.
-   Known limitation, older than this change: Node cannot load
    onnxruntime's native addon in a second worker thread of the same process
    after the first worker exited (`ERR_DLOPEN_FAILED`, reported as the
    `worker_native` category). After a worker is retired by a failure or a
    watchdog timeout, local narration therefore cannot load a replacement until
    the VS Code window is reloaded. Cancellation alone does not retire the
    worker, so ordinary use is unaffected. A replacement that survives an exit
    needs the engine in a separate process, which is deliberately not part of
    this release.

## Local Kokoro support detection, 2026-11-08

-   A user on the Ubuntu host reported working ElevenLabs but repeated local
    Kokoro `unsupported` diagnostics on 0.20.0. This isolates a support gate; it
    does not yet establish the exact host condition. The earlier detector used
    only Node's system report and classified missing evidence as unsupported.
-   Retain Linux x64 and host-placement checks. If the report is unavailable,
    accept only bounded positive GNU libc evidence from this process's mappings;
    a system getconf command could describe a different runtime. Keep musl,
    unknown, failed or incomplete evidence blocked. Copy only fixed failure
    categories, not reports, mappings, paths or environment values.
-   Model-presence diagnostics describe setup, separately from executable
    platform/runtime capability. A model cached by the workspace extension does
    not establish support on the local companion.
-   Centralize synchronous diagnostic exception isolation in one shared helper
    while preserving dynamic callback lookup and the original receiver. This
    retains the existing fault boundary and removes duplicated catch
    implementations; it does not permit observer errors to change operation
    outcomes. Exercise the actual bundled boundary through a real Controller
    consumer, and keep its model and independent unit tests.

## Batch file admission, 2026-11-08

-   The controller rejects an editing batch that names its file only after its
    first edit, before rehearsal or playback. Remove the player's duplicate
    late-name guard and its bookkeeping because accepted production batches
    cannot reach it. Keep the player guard against naming a second file and the
    public controller rejection. Direct calls to the internal player are not a
    substitute for controller admission.
-   The `BatchFile` model retains the file-before-edit invariant and its existing
    negative controls. The verified unreachable branch removal leaves its
    reachable state count unchanged; the native integration case still checks
    the public late-name rejection.

## Release integration boundaries, 2026-11-08

-   Verify session restoration with installed main and companion extensions in
    two normal VS Code launches sharing one disposable profile and workspace.
    Extension-test mode uses in-memory storage, so it cannot establish restart
    persistence. Require both stage results and a real workspace database.
-   Keep rare failure tests at named public editor or VS Code boundaries, with
    the real bundled controller, playback, terminal and reports around them.
    Restore descriptors, verify the failed outcome, and verify healthy recovery.
    These are controlled fault injections, not reproduced operating-system faults.
-   Isolate application and shared storage for native tests. Linux synthetic-key
    tests also use the basic password backend, send no cloud request, and remove
    the synthetic key unconditionally. The inspected runtime routes AI Pair
    secrets to application storage; its shared-secret allowlist is unrelated.
-   The restart harness bounds the launcher wait and requires the actual Code
    binary. Its timeout watchdog does not promise descendant cleanup for
    arbitrary CLI wrappers. Normal successful runs close their own windows.

-   Catalog integration tests intercept the fixed ElevenLabs voices endpoint
    before activation and return controlled provider responses. They exercise
    the real client, catalog and settings without sending the synthetic key
    to the network; they do not establish live account voice availability.

## CI ONNX Runtime installation, 2026-11-08

-   Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` in the CI and VSIX workflows.
    Speech selects the CPU execution provider, which is packaged with the npm
    dependency; skipping the unused CUDA download avoids an external GPU
    artifact dependency during CI. This setting applies to CI only and does
    not change developer installations or ONNX Runtime versions.

## CI resilience and model selection, 2026-11-08

-   Use current GitHub-maintained Node 24 action releases and retry transient
    download failures, retaining the pinned release asset IDs and SHA-256
    verification. Exhausted retries and checksum mismatches still fail CI.
-   Keep the specs job present on every run. Only a pull request whose nonempty
    diff contains exclusively recognized test files or the explicitly named VS
    Code integration harness files skips TLC; source, model,
    workflow and unknown changes, an unavailable base, and push events run
    every model. Disabling rename detection checks both paths of a move.

## Batch identity on session recovery, 2026-11-08

Save the next batch ID with the session so a normal saved-session reload keeps
allocating beyond IDs already reported. When `nextBatchId` is missing or
invalid, use one above the largest unreported finished batch ID. Older
snapshots cannot recover IDs that have already left that list. Workspace
storage is asynchronous,
so a crash before its latest write can still reuse an ID. This change does not
replay interrupted work and does not address terminal command IDs (issue #11).

## Speech reminders, 2026-11-08

-   Treat one concise selected narration per batch as the usual shape, while
    preserving the one-selection and 45-word limits and the programmer's
    control of speech. After three accepted batches without a selection, a
    step report may remind the agent once and restart the count.
-   Gate the reminder on current local settings, provider prerequisites and
    output readiness. The companion answers an epoch-bound readiness query;
    no text, key or audio crosses it and no provider request is made. A local
    check cannot guarantee that a provider or audio device will succeed later.

-   Try TLC's official named release URL before the pinned asset API URL, after
    repeated API 504 responses. Both must match the same pinned SHA-256; the
    named release can change, so a mismatch falls back and never runs TLC.
