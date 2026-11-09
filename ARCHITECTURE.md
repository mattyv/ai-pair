# Architecture

The components of the tool, how they find and talk to each other, and how a
pairing session starts and ends. The agent-facing contract is in
[PROTOCOL.md](PROTOCOL.md); the programmer-facing design is in
[DESIGN.md](DESIGN.md).

The diagrams of these components, with a guided tour, are in the interactive
page, [viewable on GitHub Pages][pages] and kept in
[docs/ai-pair.html](docs/ai-pair.html).

[pages]: https://mattyv.github.io/ai-pair/ai-pair.html

Status: describes the 0.22.0 implementation on this feature branch.

The source is `.archi/ai-pair.json`. To regenerate the page with
Archi-Techture 1.5.1, set `ARCHI_TO_HTML` to its `out/tools/archi-to-html.js`
path, then run:

```bash
node --input-type=module -e 'import {readFile,writeFile} from "node:fs/promises"; import {normalizeArchitecture as n} from "./scripts/normalize_architecture.ts"; const p=".archi/ai-pair.json"; await writeFile(p,await n(await readFile(p,"utf8"),"json"))'
node "$ARCHI_TO_HTML" --title 'AI Pair architecture' .archi/ai-pair.json \
  -o /tmp/ai-pair-archi-raw.html
node --input-type=module -e 'import {readFile,writeFile} from "node:fs/promises"; import {normalizeArchitecture as n} from "./scripts/normalize_architecture.ts"; await writeFile("docs/ai-pair.html",await n(await readFile("/tmp/ai-pair-archi-raw.html","utf8"),"html"))'
```

The normalizer preserves the diagram data while formatting the export and
representing Unicode with context-appropriate escapes. Validate the bundle
with Archi's `validate-archi.js` and check the regenerated page in a browser.

## Components

```text
┌──────────────────┐  stdio (MCP)  ┌────────────┐  WebSocket, 127.0.0.1  ┌─────────────────────────────┐
│  agent harness   │ ────────────▶ │  pair-mcp  │ ─────────────────────▶ │  VS Code extension          │
│  (Claude Code,   │               │  (relay)   │     + auth token       │                             │
│   Codex, ...)    │               └────────────┘                        │   core                      │
└──────────────────┘                                                     │     │                       │
                                                                         │   VS Code adapter           │
                                                                         │     │                       │
                                                                         │   narration panel (webview) │
                                                                         └─────────────────────────────┘
```

-   **`pair-mcp`** is the MCP server the harness launches over stdio. It holds
    the tool schemas, the server instructions, and the `start` prompt, forwards
    every tool call to the extension, and renders the extension's structured
    reports as the text the agent reads. It has no session state of its own.
-   **The core** is an editor-agnostic TypeScript library, running inside the
    extension: sessions, the batch queue, the playback scheduler, place
    resolution, cursor tracking, the event log, and report assembly. It has no
    editor dependencies, so it can be tested against a fake editor. An optional
    deferred reply waits for the player's current action boundary; urgent
    interruptions still stop playback immediately.
-   **The VS Code adapter** is a thin layer over the VS Code API: apply edits
    with undo stops, report document changes, render decorations, scroll, save.
    It identifies its own edits by keeping a queue of pending edits per file
    and matching each change VS Code reports by offset, deleted length, and
    text. An unmatched editor change is classified conservatively; this does
    not establish that a person made it.
-   **Command terminals** are owned by the VS Code adapter. Eligible idle Pair
    terminals can be reused; explicit reveal uses the command ID and reports
    unavailable if its terminal has closed or been reused. Automatic visibility
    is an independent persisted preference.
-   **Code playback** groups the existing atomic edits in the core. For line
    and block modes, the editor adapter highlights each group while the panel
    supplies the existing reading countdown control.
-   **Session diagnostics** keep a bounded allowlisted lifecycle history in
    the VS Code adapter, including speech readiness, button dispatch and fixed
    error categories without requiring a pairing session. The panel requests a
    snapshot explicitly; its clipboard
    export contains no chat, code, paths, command text, output, or tokens.
-   **Selected speech** is an optional port on the session controller. With the
    local companion installed, the workspace port forwards bounded requests to
    the UI host. One local service owns playback, cancellation and page
    generations for both providers.
    Kokoro uses a local CPU worker after explicit model setup. The optional
    ElevenLabs client sends only selected narration or an explicit voice preview
    to its fixed HTTPS API. Its API key stays in the local companion's VS Code
    SecretStorage; the panel receives key-presence status and
    bounded voice metadata. Cloud requests have independent deadlines and byte
    limits. Both providers produce bounded WAV audio for a shared output router.
    The companion resolves System default or a selected device to one concrete
    local endpoint before synthesis. Linux uses PipeWire; macOS and Windows use
    bundled CoreAudio and WASAPI helpers. Each physical playback rechecks the
    captured endpoint and never substitutes another. The legacy local path
    without a companion retains webview default audio and the PipeWire override.
    The legacy router waits for matching
    browser retirement or actual page disposal, and retains native process
    ownership until close. Page replacement and interruption invalidate the
    active unit. Speech and
    reading complete independently; speech never approves a command or releases
    a reading hold. After three accepted batches without selected narration, the
    controller checks current readiness before adding a reminder to a step
    report. The companion readiness query is scoped to the connection epoch and
    returns only a Boolean; it does not synthesize speech or transfer keys,
    narration, or audio. Readiness is a local check, not a promise of future
    playback. History and diagnostics do not retain speech audio.
-   **The narration panel** is a webview. It talks to the extension via
    `postMessage`, with the messages typed in
    [`panel_messages.ts`](packages/vscode/src/panel_messages.ts). Its markup is
    [`panel_html.ts`](packages/vscode/src/panel_html.ts), its styles are
    [`webview/panel.css`](packages/vscode/src/webview/panel.css), built as
    `dist/panel.css`, and its script is
    [`webview/panel.ts`](packages/vscode/src/webview/panel.ts), bundled as
    `dist/panel.js`. The script finds the elements it updates by their `data-ui`
    attribute; the markup has no `id`s.

### Local audio placement

The optional `packages/audio-ui` extension declares `extensionKind: ["ui"]`.
It owns the actual Pair view, local speech configuration, credentials and
output devices. The main extension keeps workspace state and dispatches editor,
file and terminal actions on the workspace host. The `Local audio placement`
diagram shows this boundary, including an isolated SSH placement proof.

`PanelPlacement` and `AttachmentGate` use prepare/commit before registering the
view. A successful prepare does not register anything; committing selects the
companion irrevocably for the current window. Missing companions retain the
legacy local behavior or remote text-only behavior. Reconnection requires a
new window attachment rather than starting another audio owner.

The hosts exchange versioned allowlisted command frames with separate sequence
numbers per direction. Ordered bounded chunks carry visible panel updates;
keys and audio never enter those frames. A local connection lease stops audio
after a lost workspace connection. Local reply and disposal handling retire
audio before forwarding related workspace actions.

`packages/audio-native` separates logical admission from physical ownership.
Cancellation invalidates pending discovery; playback cannot start after that
cancellation, and a process remains owned through actual close. A saved device
that disappears stays unavailable. Same-graph PipeWire metadata resolves the
Linux default, while the native macOS and Windows helpers enumerate and open
platform endpoint identities. Their manifests contain fixed helper names and
SHA-256 values generated during packaging.

Native build tests, API-level stream tests and physical audibility are distinct
evidence. A runner without an output reports its stream test as skipped. Local
Kokoro runtime support remains Linux x64/glibc; the audio interface does not
claim broader synthesis support.

### Why a relay

Every harness supports stdio MCP servers, and a stdio config is static: "run
this command". If the extension served MCP over HTTP directly, the harness would
need a URL whose port changes with every VS Code window. The relay keeps the
harness config fixed and resolves which editor to talk to at runtime.

### Why the core runs inside the extension

It's simpler, and playback timing stays next to the editor. The core could later
become a separate process with thin editor clients (like a language server with
document sync), which may be needed for Zed. That move wouldn't change the
protocol.

## Discovery and connection

**Each VS Code window registers itself.** On activation, the extension starts a
WebSocket server on a random port bound to `127.0.0.1`, and writes a discovery
file:

```jsonc
// ~/.ai-pair/windows/<pid>.json   (mode 0600)
{
  "pid": 41234,
  "workspaceFolders": ["/Users/me/projects/todo-app"],
  "port": 53817,
  "token": "...",             // random, per window
  "protocolVersion": 5,
  "lastFocused": 1758700000000   // epoch ms, updated when the window gains focus
}
```

The file is removed on deactivation.

**The relay finds its window lazily**, when a session starts, not at launch. The
editor may be opened after the harness. To find the window it:

1.  If `start` supplies a working directory, validates that it is an existing
    absolute directory and selects it alone. Otherwise, gathers the harness's
    MCP roots and the relay's working directory as candidates.
2.  Reads discovery files, drops stale ones (the process is gone), and finds
    the first candidate contained in an open window. An explicit directory
    never falls back to another candidate.
3.  Picks the window whose workspace folder contains it (the longest match). On
    a tie, it picks the most recently focused.
4.  Checks the selected window's extension version and relay digest against
    the running relay. Missing or mismatched identity fails with update and
    reconnect guidance before forwarding a call.
5.  Connects and authenticates with the token and protocol version.

Older relays already running cannot enforce the identity check; restart them
after updating and reloading every window.

If no window matches, `start` fails with a clear message: "Open
`/Users/me/projects/todo-app` in VS Code with the extension installed."

**Relay <-> extension messages** are JSON objects with a `type` field, over the
WebSocket, mirroring the MCP tool calls one to one:

-   `hello { token, protocolVersion }`: the handshake, answered with `welcome`,
    or with `rejected { reason }` for a wrong token or another protocol version.
-   `call { id, tool, args }` -> `result { id, ... }` or `error { id, ... }`.
-   `cancel { id }`: forwarded when the harness cancels a tool call, for example
    when the programmer presses Esc in the harness.
-   `return { report, mayRepeat? }`: a report that arrived for a call the relay
    had already cancelled, handed back to be delivered again (see below).
    `mayRepeat` marks one whose cancel came after the answer, which the agent
    may have seen.

**Cancelling a call doesn't affect the session.** A cancelled `step` has already
queued its batch, and its outcome is reported on the next call. Cancellation
just releases the blocked call, without taking a report.

**Reports survive a race with cancellation.** A cancellation takes a moment to
reach the editor. If the call returns in that moment (say, because the
programmer just wrote a message), the harness has already given up on it and the
report would be lost. So the relay sends such a report back, and the editor puts
its batches and events back to be reported again. The WebSocket is ordered, so
this happens before the agent's next call arrives.

**Paths are relative to the agent's working directory.** The relay sends the
working directory it found with `start`, and the session resolves and reports
paths relative to it, which may be a subfolder of the workspace.

## Sessions

Each editing batch names its file before the first edit. The player refuses a
second named file or an edit at a cursor in another file. Rehearsal runs the
same checks before the batch is queued. An explicit structural newline splits
an adjacent matching pair in Python or JSON code; its conservative lexical
scanner refuses strings, comments, and ambiguous formatted-string expressions.
It is not a Python grammar parser.

After playback the editor reports advisory diagnostics for edited files. VS
Code diagnostics are snapshots with unconfirmed freshness and can be
unavailable. Python files also get a syntax check using system `python3`,
which can differ from the project interpreter.
Warnings report limitations and failures of these checks.

**One MCP connection can host many pairing sessions, one after another.** The
programmer works in the harness as usual, starts pairing when they want to, ends
it, goes back to the harness, and may pair again later.

A **session**:

-   **starts** when the agent calls `start`, typically because the programmer
    asked it to pair, or ran the `start` prompt. The panel opens.
-   **ends** when:
    - the programmer presses End session in the panel, or
    - the agent calls `end` (e.g. the programmer said they're done), or
    - the agent's `start` from another directory replaces a suspended one, or
    - the window closes.
-   **is suspended**, not ended, when the relay disconnects (the harness exited)
    or the window reloads (#25). It keeps its turn, the agent's cursor and
    selection, its directory, and the panel's history, in memory and in the
    workspace's storage, until the programmer ends it, or the agent's `start`
    from the same directory resumes it. Messages the programmer sends meanwhile
    reach the agent when it's back. Nothing plays meanwhile: what was queued is
    discarded, and reported then.
-   **belongs to one window**, and a window has at most one session at a time. A
    `start` while another session is active in that window is rejected.

Outside a session, pair tools other than `start` fail with `no_session`, so an
agent can't accidentally drive the editor when the programmer isn't pairing. The
programmer's edits between sessions aren't tracked. A new session starts fresh,
and the agent should re-read what it needs. So does an agent whose session
resumes: it may be a new conversation, so it has seen no lines, and it reads
them again before it gives a line number.

The panel keeps each session's narration history. Between sessions it shows "No
active session", and how to start one. While a session is suspended, it keeps
its history, and its status says it's waiting for the agent.

## Starting a session

**First-time setup.** The command *AI Pair: Set Up Agent* registers `pair-mcp`
with the harnesses the programmer picks, in each one's user-wide MCP
configuration, so it works in every project. It edits only the `pair` entry,
keeping the rest of the file as it was: JSON and JSONC with `jsonc-parser`,
Codex's TOML as text, table by table (a TOML round trip would drop comments).
For Claude Code it runs `claude mcp add --scope user` when the `claude` command
is there, since Claude Code rewrites `~/.claude.json` constantly. For any other
harness it copies the config snippet to the clipboard. The extension
offers this once, the first time it starts. The harnesses and their files are in
[`agents.ts`](packages/vscode/src/agents.ts).

**Each session.** The programmer asks the agent to pair ("let's pair on adding a
todos API, I'm new to Express"), or runs the server's `start` prompt (in Claude
Code: `/mcp__pair__start`). The agent calls `start`, which returns the [agent
guide](AGENT_GUIDE.md) along with the first report.

**From the panel.** With Claude Code's CLI installed and set up for the pair
server, and a folder open, the idle view offers **Start a session**: it runs
`claude -p "start pairing session" --allowedTools mcp__pair` in the first
workspace folder, as the process of a terminal that is never shown, so the Pair
panel stays in front (#107, #115, `specs/Start.tla`). Print mode sends the
prompt at once, and the agent's turn lasts the whole session, so the CLI exits
when the session ends and its terminal closes with it. Print mode refuses any
tool that would ask for permission, so the pair server's tools are allowed on
the command line; every other tool follows the programmer's own Claude Code
settings. A second start while that terminal is open does nothing. Until the
agent's `start` lands, the idle view says a session is starting; the note also
goes when the CLI exits without starting one, since `start()` resolves when the
terminal closes (#118). The panel asks again after Set Up Agent. Claude Code's
extension is not used: its open command only fills its input box, which needs
Enter pressed there, and it rewrites `claudeCode.preferredLocation` to `panel`.
Other harnesses keep the text asking the programmer to ask their agent.

## Distribution

`pair-mcp` is **bundled inside the extension**, not published separately, so the
relay and the extension can never be out of sync.

The extension's install path changes with every version, so on activation the
extension writes a launcher at a fixed path, `~/.ai-pair/bin/pair-mcp`
(`pair-mcp.cmd` on Windows), pointing at the current version. The launcher runs
the relay with VS Code's own runtime (`ELECTRON_RUN_AS_NODE=1`), so the
programmer doesn't need Node installed.

GitHub Actions checks and packages the extension on Ubuntu, then uploads a VSIX
artifact named with its version and commit. The artifact can be downloaded and
installed on an Ubuntu host. After reloading VS Code, the runtime reports the
bundled version and build identity, allowing the running build to be checked.

## Repository layout

```text
packages/
  protocol/   types of the agent protocol and the relay <-> editor messages
  core/       editor-agnostic session and playback logic, and the WebSocket
              server (bridge) with discovery
  relay/      pair-mcp: stdio MCP <-> WebSocket; tool schemas, instructions,
              the start prompt; bundles AGENT_GUIDE.md at build time
  vscode/     the extension: adapter, panel, launcher, setup; ships the relay
```

TypeScript throughout, npm workspaces, bundled with esbuild. The relay uses the
official MCP TypeScript SDK.

## Out of scope for v1

-   **Permission prompts.** When the harness asks for permission, it notifies
    the programmer itself.
-   **Starting from the editor** (see above).
-   **Multiple agents** in one window.
-   **Zed.**

## Bounded sentence narration

Bounded sentence pipelining is implemented for local Kokoro narration. The Archi
`Sentence narration` diagram records its ownership boundaries.

-   One admitted narration text keeps one reading clock and one concrete output
    lease for all of its parts. Showing the text, the reading pace and command
    approval do not depend on sentence boundaries.
-   `speech_segments.ts` splits the text into at most four parts, each an exact
    slice of the source. The last part takes any remainder, and text that cannot
    be split with certainty stays whole.
-   The warm local client synthesizes one next part while the current part
    plays, so there is at most one inference and one part of lookahead. Each
    physical output retires before the next part starts, and the unit finishes
    only on its final part.
-   Only text already admitted for the unit is synthesized. Future cloud
    narration is never synthesized ahead, and an explanation is never dropped to
    catch up.
-   ElevenLabs keeps one request per unit, and the legacy output path stays one
    waveform.

The pipeline still needs final review and packaged verification before release.

## Warm local synthesis worker

One warm worker thread serves local Kokoro synthesis for each epoch. The Archi
`Warm local synthesis` diagram shows the boundaries; the TLA+ model is
`specs/WarmSynthesisWorker.tla`.

-   `speech_local_protocol.ts` defines the protocol with strict zod schemas:
    `init`, `ready` (with capabilities), `synthesize`, `result`, `failure` and
    `shutdown`. Every frame carries the protocol version, and every request and
    response carries the epoch, the unit id and the part ordinal. A failure
    carries one of four fixed categories (`load`, `synthesis`, `protocol`,
    `busy`), never free text.
-   `speech_local_client.ts` (`LocalSynthesisClient`) owns the worker through
    an injected factory. It loads the model once and runs one inference at a
    time. The worker's `ready` capabilities must equal the client's own
    constants.
-   A cancel invalidates the in-flight result at once, but the inference keeps
    ownership of the worker until its result arrives or an independent watchdog
    retires the worker.
-   A retiring worker holds the slot until its actual exit event. Only then can
    a replacement start.
-   The client rejects stale, duplicate and late responses, and the text of a
    canceled or retired inference is never replayed.
-   `SpeechService` drives the client in place of inline worker handling.
    Admitting a unit waits until the local slot is free.

This is not a new engine, and it adds no persistent synthesis cache.
ElevenLabs synthesis is unchanged. The shipped transport is a Node worker
thread; the factory keeps the client independent of it.

## Independent listening speed

The listening-rate control is experimental. It snapshots its rate once per
narration unit. A separate tempo worker processes the tail-free mono PCM with a
transient-aware overlap-add transform, which keeps the pitch. The service then
frames the actual transformed samples and appends the fixed thinking tail once.

-   Rate 1.0 bypasses processing byte for byte. So does an input shorter than
    3072 samples, which stays within one window of every target length.
-   Admitting a unit at a rate other than 1.0 waits until the tempo worker has
    retired, as well as the local synthesis slot.
-   Cancellation keeps the tempo worker's slot until it actually terminates, and
    stale unit or part responses cannot restart audio.
-   The synthesis-speed controls, the reading clock and the code pace stay
    separate from listening speed.

The Archi `Speech tempo` diagram shows the boundaries. Offline metrics do not
establish human listening quality.

## Local runtime support evidence

Kokoro support requires a local Linux x64 host and positive GNU libc evidence.
The shared platform detector checks Node's runtime report first, then reads
bounded mappings of the same running process if the report is unavailable. It
accepts exact GNU libc and loader records, including older versioned names;
musl, deleted, malformed, oversized and inaccessible evidence remains blocked.
The main host retains its remote-workspace guard; the local UI companion checks
its own process. Only fixed reason codes enter diagnostics. Model presence is
reported as setup state, separately from platform capability. This fallback
does not prove compatibility with every glibc layout or native library build.

Synchronous diagnostic observer errors are isolated by one shared core helper.
Callers retain their original receivers and read the current callback for each
event. The helper suppresses thrown observer errors while preserving operation
progress; it does not prevent intentional reentrant side effects.

## Companion status compatibility

Private workspace-to-companion protocol version 2 carries the number of
accepted batches that have not started. A new workspace refuses an installed
incompatible companion before selecting an owner and asks for both extensions
to be updated and reloaded. The new companion rejects older preparation and
shows the same guidance. An already-installed older workspace can still
select its own legacy fallback. The public MCP protocol is unchanged.

GPU compute selection and setup status are local speech controls. The companion
handles them in its own panel without adding private transport frames, so this
change does not alter version 2 or the public MCP protocol. An older companion
does not offer the GPU controls. The companion panel routing test verifies the
local boundary.
