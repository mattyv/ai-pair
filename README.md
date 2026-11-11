# AI Pair Programmer

## Voice status

The speaker icon beside the toolbar controls shows whether automatic narration
is off, not checked, starting, ready, or unavailable. Hover for the reason, or
select it to open speech settings. Ready means the available cached checks
passed; it does not confirm audible sound or cloud account availability.

When Kokoro narration is enabled, its model starts as the extension loads,
before a Pair MCP session starts. The icon pulses orange during startup
(static orange with reduced motion). Startup does not download missing models,
speak text or make a paid cloud request.

## Demo and diagnostics

In Claude Code, run `/pair:demo` to guide a real Pair session in a fresh scratch
file, including an optional programmer edit and a navigator comment, or
`/pair:diagnose` to inspect connection, command, speech and audio
status without changing settings. The legacy `/mcp__pair__demo` and
`/mcp__pair__diagnose` forms also work. The demo uses the current speech
setting; only you can confirm whether you heard it. Diagnostics alone do not
run a paid speech preview.

The extension includes the corresponding `skills/ai-pair-demo/SKILL.md` and
`skills/ai-pair-diagnose/SKILL.md`. Optionally copy their directories to your Claude
`.claude/skills` directory for `/ai-pair-demo` and `/ai-pair-diagnose`. No
skill or project configuration is installed automatically.

## Additions in this fork

This fork builds on the original [AI Pair project](https://github.com/faiface/ai-pair).
It adds:

-   Toolbar controls wrap in narrow panels, and their popup menus stay within
    the panel viewport.
-   A choice of conversation order and clearer message text.
-   Clearer pause and playback status. Click the reading indicator to finish
    its timer, or hold it to pause the timer.
-   Typing, Lines, or Blocks in a separate code-display dropdown and Settings.
    The existing pace and reading-speed controls still adjust playback.
-   Quiet command terminals by default, with an option to reveal a run.
-   Copyable session and speech diagnostics, plus a running version and build
    in Settings. Speech diagnostics show capability, button dispatch and safe
    failure categories without copying keys, narration or audio.
-   When speech is enabled, every short message from the agent is spoken, one
    after another, and typing waits for the voice, so you can keep your eyes on
    the code and still hear when the agent needs you. A message over 45 words
    or 280 characters is shown without speech, and the agent can keep one
    silent. The agent may be reminded after several batches with nothing
    spoken. The reminder does not enable speech or make a provider request.
    The scripted demo speaks too.
-   CPU/GPU changes and restarted speech wait for previous local work to finish
    shutting down before starting a replacement. GPU use still requires fresh
    checks, and physical validation of this lifecycle change remains open.
-   Optional local Kokoro speech for the connected coding agent's narration.
    Speech is off by default and needs no additional API key. In Settings,
    run **Download Kokoro model** to download about 94 MB, then **Preview voice**.
    Settings show the model path, pinned source and latest verification result.
    Local speech requires a local Linux x64 desktop with glibc, such as
    Ubuntu, or a Mac (Apple silicon or Intel); the rest of Pair works without
    speech. Install the VSIX built for your Mac's architecture.
-   Experimental GPU acceleration for Kokoro on supported Linux x64 systems.
    In Settings, select **Auto** or **GPU** and choose **Set up GPU**. Setup
    requires the CPU model and may download an additional pinned model of about
    326 MB. It checks the local runtime, physical AMD device and driver before
    reporting readiness. CPU remains the default; Auto can fall back to CPU,
    while GPU mode fails closed. One supplied AMD system has been tested;
    broader hardware validation remains open.
-   Bounded sentence pipelining for local Kokoro in the audio companion. The
    first sentence can play while one following part is prepared. The complete
    selected text, reading countdown and output device stay fixed for the unit.
    ElevenLabs continues to use one synthesis request per selected narration.
-   An experimental **Listening speed** setting (0.75, 1, 1.25 or 1.5; default 1)
    that changes how fast the narration plays without changing its pitch. It is
    separate from each provider's voice speed and from the reading and code
    pace, is applied on your computer to the next narration or preview, and
    never makes another cloud request. At 1 the audio is untouched. The stretch
    has been checked with synthetic signals only; nobody has validated how
    speech sounds at 0.75, 1.25 or 1.5, so treat those rates as a trial.
-   The local Kokoro engine now runs behind one versioned worker protocol. The
    model loads once and stays loaded between narrations; a canceled or failed
    narration is never replayed, and a replacement worker waits until the old
    one has really exited. No new engine, download or key is involved.
-   Optional ElevenLabs cloud speech, using the same selected narration and
    reading controls. Choose **ElevenLabs** in Settings, add your API key through
    the secure VS Code prompt, load your account voices, choose one and use
    **Preview voice**. Every spoken message and each preview goes to
    ElevenLabs and uses your account credits. Saving a key does not enable
    speech. Voice availability
    depends on your account; a free account may have no eligible API voices.
    Kokoro remains the local option and the default provider.
-   A shared **Speech output** choice for both providers, with **System default**
    or an explicit local device. The optional **AI Pair Local Audio** companion
    owns playback on the computer running the VS Code window, including SSH
    workspaces. Native adapters use PipeWire on Linux, CoreAudio on macOS and
    WASAPI on Windows. Device choices stay local; unavailable devices report an
    error rather than silently switching outputs. Linux needs `pw-play`,
    `pw-dump` and `setpriv`; macOS and Windows helpers ship in the companion.

[Download a fork build from GitHub Actions](https://github.com/mattyv/ai-pair/actions)
(run **Build VSIX**, then download its artifact). The Marketplace link in the
original README below installs the upstream version without these additions.

## Using the local audio companion

Download both fork artifacts from the same **Build VSIX** run. Install AI Pair
for the workspace and **AI Pair Local Audio** locally on the computer with your
speakers, then reload the VS Code window. In an SSH or container window, the
companion belongs on the local side. It is optional for existing local use;
remote speech requires it.

The companion keeps its own local key and model storage. Add your ElevenLabs
key through its secure Settings prompt, or set up Kokoro there. The companion
is built once, on Linux, so its Kokoro runs on a Linux x64 desktop only; on a
Mac, use the main extension's local speech, or ElevenLabs through the companion.
Cross-platform playback does not make Kokoro available on every operating
system. No key or generated audio is sent
to the workspace extension. Speech remains off until you enable it; Preview is
an explicit test action.

Native compilation, API-level playback and physical audibility are separate
checks. The current Windows hosted runner has no default output device, so its
stream test is reported as skipped rather than passed. Hardware and device-loss
verification remains necessary for each target environment.

## Original project README

**[Install it from the VS Code
Marketplace](https://marketplace.visualstudio.com/items?itemName=michalstrba.ai-pair)**

## For those of us who want, need, or love to stay close to the code

> A **mirror neuron** is a neuron that fires both when an animal acts and when
> the animal observes the same action performed by another.
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Mirror_neuron)

### Be there for every keystroke

![The agent explains the update method in the Pair panel, then types it in the
editor](media/every-keystroke.gif)

Some of us, at least some of the time, want to understand our code at a deep
level. For that, handing a task to an agent and reviewing the diff that comes
back can be exhausting. With *AI Pair Programmer*, you're there for every
keystroke instead, and you end up knowing the code almost as if you'd typed it
yourself.

It's pair programming where your coding agent has the keyboard. It types in your
editor slowly enough to follow and explains what it's doing. Interrupt it
whenever you like, or take over and let it watch you for a change.

### Interrupt and steer

![The programmer asks the agent to fix its imports, and it adds them at the top
of the file](media/interrupt-and-steer.gif)

### Watch it change its mind in real time

![The agent writes a comment, reconsiders, deletes it, and documents the type
differently](media/change-its-mind.gif)

It's also a good way to learn a new technology, or to have the agent walk you
through code you don't know yet.

### Ask it to explain code line by line

![The agent walks through a function line by line, highlighting each line and
explaining it in the Pair panel](media/explain-line-by-line.gif)

It works in VS Code, with the coding agent you already use. Setup is built in
for Claude Code, Codex, OpenCode, Gemini CLI and Cursor, and any agent that
supports MCP can be connected by hand.

**Note:** It works best with strong models; weaker ones tend to struggle with
this way of working.

## How to use it

Once the extension is [installed](#install) and [connected to your
agent](#connect-your-agent), keep using your agent as usual. When you want to
pair:

1.  Open the project in VS Code, and start your agent **in the same folder** (or
    a subfolder of it).
2.  Ask it to pair: *"Let's pair on adding a settings page."* In Claude Code,
    you can also run `/mcp__pair__start`. If you want to learn the technology
    too, say so: *"...I'm new to Svelte, explain as you go."* With Claude Code's
    CLI installed and set up, the **Pair** panel also offers **Start a
    session**: it starts Claude Code in a hidden terminal with the request
    already sent, and the Pair panel stays in front. The terminal closes when
    the session ends. Until the agent starts, the panel says a session is
    starting.
3.  The **Pair** panel opens in the secondary side bar, and the agent's cursor
    appears in your editor.

Anything you say or edit interrupts the agent, so its next move takes it into
account. While you pair:

| To... | Do this |
|---|---|
| say something to the agent | type in the reply box, press Enter. Typing pauses playback. In Settings, choose **Finish current action first** to wait for the action boundary; long commands can delay replies and Stop remains immediate. |
| ask about some code | select it in the editor, then reply: the selection goes along (**x** leaves it out) |
| let it run a command | **Run**, **Allow for session**, or **Skip** in the panel; **Show terminal** reveals the command's terminal |
| stop it right now | **Interrupt**, or just edit the code: any edit interrupts |
| look around | scroll or switch files. Playback pauses until you **Resume**, which brings you back to the agent's cursor |
| write a part yourself | **My turn**. The agent becomes the navigator and comments as you type. **Hand back** returns the turn, with your reply if you typed one |
| change the pace or code display | the speed menu (**1.0x**) sets the pace and chooses Typing, Lines, or Blocks for the next typing action |
| manage the reading pause | click the ring to finish; hold it to pause the countdown until release. Focus it and use Space for the same behavior |
| finish | **End**, or tell the agent you're done. You can pair again anytime |

Lines and Blocks show code in groups with a reading pause and highlight for
each group. Reading speed and the main pace adjust those pauses; click or hold
the reading ring to finish or pause one. Typing remains the default.

The status shows when playback is **Paused** or **Playing**. Reading pauses,
command confirmations, your turn and suspended sessions remain distinct. A
ready count shows accepted work that has not started, and completed command
results promptly reach a waiting agent. The cursor is yellow and pulsing when
the agent has just spoken and is waiting for you to read.

**Try it without an agent:** *AI Pair: Play Demo Session* plays a scripted
session that adds a small API to an Express app, which it creates in
`ai-pair-demo/`.

## How it works under the hood

```text
agent (Claude Code, ...) ── stdio MCP ──▶ pair-mcp ── local WebSocket ──▶ VS Code extension
```

The agent submits small batches of actions: say, move, select, type, newline,
delete, point, run. The extension plays them at a human pace and reports back exactly
what happened, including everything you did in the meantime. The agent plans its
next batch while you watch the current one, which hides most of its thinking
time. And it's never more than one batch ahead, so your interruptions land
immediately. Typing handles CRLF line endings consistently and preserves a
standalone carriage return. Structural newlines and single-close moves are
explicit choices; other typing remains literal.

The design is written up in:

-   [PROTOCOL.md](PROTOCOL.md): the tools and their exact semantics, as the
    agent sees them.
-   [AGENT_GUIDE.md](AGENT_GUIDE.md): how the agent should pair, returned to it
    when a session starts.
-   [DESIGN.md](DESIGN.md): what you see: the cursor, the panel, the timing.
-   [ARCHITECTURE.md](ARCHITECTURE.md): the components and how they connect.

## Install

You need **VS Code 1.106 or newer**. Install **AI Pair** from the [VS Code
Marketplace](https://marketplace.visualstudio.com/items?itemName=michalstrba.ai-pair):
in the Extensions view, search for `@id:michalstrba.ai-pair`, or run:

```sh
code --install-extension michalstrba.ai-pair
```

For a build from this fork, open the [Build VSIX workflow](https://github.com/mattyv/ai-pair/actions/workflows/build-vsix.yml),
choose a successful run for the branch you want, and download its `.vsix`
artifact. Copy it to the Ubuntu host running VS Code and install it there:

```sh
code --install-extension /path/to/ai-pair-build.vsix
```

For a local development build, the VSIX can instead be taken directly from the
shared repository folder (`/workspace/code/ai-pair` in the VM). Run the install
command on the Ubuntu host using that folder's host path.

Reload the VS Code window and restart the agent after updating. The Pair
panel's Settings dialog shows the running version and build ID, so you can
check what is actually loaded. For troubleshooting, **Copy diagnostics** in
Settings copies recent connection, session, request, pause and command status
metadata to the clipboard. It does not include chat, code, paths, command text,
or output. Copying is explicit; timestamps and numeric IDs are included.

To build it from source instead, you also need **Node.js 22.19 or newer**:

```sh
git clone https://github.com/faiface/ai-pair.git
cd ai-pair
npm install
npm run package
code --install-extension ai-pair-*.vsix
```

## Connect your agent

1.  **Open a project folder in VS Code.** The extension installs the MCP server
    your agent runs, at `~/.ai-pair/bin/pair-mcp`
    (`%USERPROFILE%\.ai-pair\bin\pair-mcp.cmd` on Windows). It runs on VS Code's
    own runtime, so it doesn't need Node.js.
2.  **Run *AI Pair: Set Up Agent*** from the command palette (VS Code also
    offers this the first time the extension starts). Pick your agents; the ones
    it finds installed are already checked. For each one, it adds a server named
    `pair` to that agent's user-wide MCP configuration, leaving everything else
    in the file as it was:

    | Agent | Where |
    |---|---|
    | **Claude Code** (the CLI, the IDE extensions, the Claude desktop app's Code tab) | `claude mcp add --scope user`, or `~/.claude.json` without the `claude` command |
    | **Codex** (the CLI, the IDE extension, the app) | `~/.codex/config.toml` (or in `$CODEX_HOME`) |
    | **OpenCode** | `~/.config/opencode/opencode.json` (`.jsonc` if you have one), on Windows too |
    | **Gemini CLI** | `~/.gemini/settings.json` |
    | **Cursor** | `~/.cursor/mcp.json` |
    | **Another agent** | copies an MCP server configuration to the clipboard: a stdio server named `pair` running the launcher |

3.  **Restart your agent** so it picks up the new server.

## Calibrate your reading speed

The pause after each of the agent's messages is sized to the message, at a rate
per character. To set that rate to your own pace, run *AI Pair: Calibrate
Reading Speed*: the Pair panel shows a passage when you type `go`, you read it,
and you type `x` the moment you finish. The rate goes into `aiPair.timing` in
your settings. Asking the agent for another passage ("use the Rainbow Passage")
has it fetch the text and start the calibration with it.

## Settings

Commands use quiet terminals by default; **Show terminal** reveals one. If shell
integration is unavailable, the terminal opens so you can see the command.
Hidden terminals are not restored when the workspace is reopened.

The Pair panel's **Settings** button lets you choose the chat order. The default
shows the newest messages at the top; choose **Oldest first** to put new messages
and the reply box at the bottom. Your choice is saved across reloads.

| Setting | |
|---|---|
| `aiPair.showTerminalsAutomatically` | Show Pair command terminals automatically (default off); also available in Pair Settings. |
| `aiPair.codePlayback` | `typing` (default), `lines`, or `blocks`; also in the code display dropdown and Settings. Applies to the next typing action. |
| `aiPair.chatOrder` | `newestFirst` (default) or `oldestFirst`; also available in the Pair panel settings. |
| `aiPair.speed` | Overall playback speed, the follow scroll's glide included (the panel's speed menu offers 0.4x to 3.0x). |
| `aiPair.readingSpeed` | Reading speed: divides the reading pauses after narration and grouped code (the panel's reading menu offers 0.4x to 3.0x). |
| `aiPair.calibrationPassage` | The passage *AI Pair: Calibrate Reading Speed* times you on, as `{ "title": ..., "text": ..., "notice": ... }`; empty, the built-in one. The agent's `calibrate` tool writes it. |
| `aiPair.agentName` | The name on the agent's cursor. |
| `aiPair.timing` | Fine-tune any typing, pause, or glide duration, e.g. `{ "afterSelectMs": 900, "type": { "wordStartMs": 140 } }`. Every key is in [`timing.ts`](packages/core/src/timing.ts). |
| `aiPair.confirmCommands` | Ask before each command the agent runs in the terminal (default on). Turned off, the agent's commands run without any prompt, not even its own. |

## Rules for the agent

Rules you and the agent settle on can live in a file, so you don't repeat them
every session. When a session starts, the agent gets them after the pairing
guide, and the panel's "Session started" line names the files it was given:

-   `~/.ai-pair/GUIDE.md`: rules for every project.
-   `.ai-pair/GUIDE.md` in a project: rules for that project. Every one from the
    workspace folder down to the agent's working directory is read, outer first,
    and none above the workspace folder. One that git ignores is left out; one
    checked in always counts.

Later files take precedence over earlier ones, and all of them over the pairing
guide. Each is plain markdown, read up to 20,000 characters. A project's file
goes into the agent's instructions, the same trust an agent's own `CLAUDE.md` or
`AGENTS.md` gets.

## Troubleshooting

-   **The agent says `no_editor`.** Its working directory isn't inside a folder
    that's open in VS Code. Open that folder in VS Code, or start the agent in
    it.
-   **The agent doesn't have the pair tools.** Restart the agent after setting
    it up. *AI Pair: Set Up Agent* marks the agents that are set up. With Claude
    Code, `claude mcp list` should show `pair`.
-   **After updating the extension,** reload the VS Code window and restart the
    agent. A session in progress waits, suspended, and the agent's next `start`
    from the same folder resumes it.

## Development

```text
packages/
  protocol/   types shared by everything
  core/       editor-agnostic sessions, playback, and the local WebSocket server
  relay/      pair-mcp, the MCP server the agent runs
  vscode/     the extension, which ships the relay
scripts/      the repository's checks and its release, in TypeScript that Node runs as is
```

```sh
npm install
npm test                  # unit and end-to-end tests
npm run typecheck         # the packages and the scripts
npm run lint              # oxlint; the scripts also to Google's TypeScript Style Guide
npm run format:check      # Prettier
npm run check:ascii       # every tracked file is ASCII, apart from scripts/check_ascii.ts's allowlist
npm run lint:swift        # Swift to Google's Swift Style Guide, with Xcode's swift-format (macOS)
npm run typecheck:swift   # the Swift icon script compiles without warnings (macOS)
npm run lint:sh           # shell scripts to Google's Shell Style Guide (needs ShellCheck and shfmt)
npm run lint:web          # the panel's HTML and CSS to Google's HTML/CSS Style Guide, and valid HTML5 (needs Java)
npm run lint:md           # Markdown to Google's Markdown style guide
npm run build             # development build of the extension
npm run test:integration  # plays a session inside a real, isolated VS Code (macOS; VSCODE_BIN for another)
npm run test:shell        # the shell scripts, with bats, against fake tlc, Code, npm, and code commands
npm run test:swift        # the icon's Swift package: its drawing, and that media/ holds what it writes (macOS)
npm run test:visual       # the panel's page in Chromium against its screenshots; test:visual:update records them
npm run test:coverage     # the unit tests, with coverage, in coverage/unit/
npm run test:integration:coverage  # the integration test, with coverage of the bundle mapped to the sources, in coverage/integration/
npm run coverage:tla      # every spec, with TLC counting how often each action fired, in coverage/tla/; an action that never fired fails it
npm run test:shell:coverage  # the shell tests under kcov, in coverage/shell/ (Linux; on macOS kcov records nothing under bats)
npm run test:swift:coverage  # the Swift tests with llvm-cov, in coverage/swift/ (macOS)
npm run coverage          # all of them; each rewrites its column of COVERAGE.md, and fails below coverage_thresholds.json
npm run package           # production build -> ai-pair-<version>.vsix
```

To run your working copy, open the repository in VS Code and press F5, or:

```sh
code --extensionDevelopmentPath="$PWD/packages/vscode" <a project folder>
```

### Releasing

Add a section for the new version to
[`packages/vscode/CHANGELOG.md`](packages/vscode/CHANGELOG.md), then, on an
up-to-date `main`:

```sh
npm run release -- patch   # or minor, major, or an exact version
```

It runs every test, bumps the version, builds the `.vsix` once and publishes
that file to the Marketplace, then commits, tags and pushes the release and
makes a GitHub release with the `.vsix` attached. It asks before publishing,
since a version can't be published twice. It needs `vsce login michalstrba` and
`gh auth login` done once.

## License

[MIT](LICENSE)
