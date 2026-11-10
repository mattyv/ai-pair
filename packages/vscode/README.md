# AI Pair

## Additions in this fork

This fork builds on the original [AI Pair project](https://github.com/faiface/ai-pair).
It adds:

-   A choice of conversation order and clearer message text.
-   Clearer pause and playback status. Click the reading indicator to finish
    its timer, or hold it to pause the timer.
-   Typing, Lines, or Blocks in a separate code-display dropdown and Settings.
    The existing pace and reading-speed controls still adjust playback.
-   Quiet command terminals by default, with an option to reveal a run.
-   Copyable session and speech diagnostics, plus a running version and build
    in Settings. Speech diagnostics show capability, button dispatch and safe
    failure categories without copying keys, narration or audio.
-   CPU/GPU changes and restarted speech wait for previous local work to finish
    shutting down before starting a replacement. GPU use still requires fresh
    checks, and physical validation of this lifecycle change remains open.
-   Optional local Kokoro speech for narration selected by the connected coding
    agent, which selects useful short explanations without a per-session prompt.
    Speech is off by default and needs no additional API key. In Settings,
    run **Download Kokoro model** to download about 94 MB, then **Preview voice**.
    Local speech requires a supported local Linux x64 desktop with glibc, such
    as Ubuntu; the rest of Pair works without speech.
-   Optional ElevenLabs cloud speech, using the same selected narration and
    reading controls. Choose **ElevenLabs** in Settings, add your API key through
    the secure VS Code prompt, load your account voices, choose one and use
    **Preview voice**. Selected text and previews go to ElevenLabs and use your
    account credits. Saving a key does not enable speech. Voice availability
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
key through its secure Settings prompt, or set up Kokoro there. Its model still
requires a supported Linux x64 desktop; cross-platform playback does not make
Kokoro available on every operating system. No key or generated audio is sent
to the workspace extension. Speech remains off until you enable it; Preview is
an explicit test action.

Native compilation, API-level playback and physical audibility are separate
checks. The current Windows hosted runner has no default output device, so its
stream test is reported as skipped rather than passed. Hardware and device-loss
verification remains necessary for each target environment.

## Original project README

## For those of us who want, need, or love to stay close to the code

> A **mirror neuron** is a neuron that fires both when an animal acts and when
> the animal observes the same action performed by another.
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Mirror_neuron)

### Be there for every keystroke

![The agent explains the update method in the Pair panel, then types it in the
editor](https://raw.githubusercontent.com/faiface/ai-pair/main/media/every-keystroke.gif)

Some of us, at least some of the time, want to understand our code at a deep
level. For that, handing a task to an agent and reviewing the diff that comes
back can be exhausting. With *AI Pair*, you're there for every keystroke
instead, and you end up knowing the code almost as if you'd typed it yourself.

It's pair programming where your coding agent has the keyboard. It types in your
editor slowly enough to follow and explains what it's doing. Interrupt it
whenever you like, or take over and let it watch you for a change.

### Interrupt and steer

![The programmer asks the agent to fix its imports, and it adds them at the top
of the
file](https://raw.githubusercontent.com/faiface/ai-pair/main/media/interrupt-and-steer.gif)

### Watch it change its mind in real time

![The agent writes a comment, reconsiders, deletes it, and documents the type
differently](https://raw.githubusercontent.com/faiface/ai-pair/main/media/change-its-mind.gif)

It's also a good way to learn a new technology, or to have the agent walk you
through code you don't know yet.

### Ask it to explain code line by line

![The agent walks through a function line by line, highlighting each line and
explaining it in the Pair
panel](https://raw.githubusercontent.com/faiface/ai-pair/main/media/explain-line-by-line.gif)

It works in VS Code, with the coding agent you already use. Setup is built in
for Claude Code, Codex, OpenCode, Gemini CLI and Cursor, and any agent that
supports MCP can be connected by hand.

**Note:** It works best with strong models; weaker ones tend to struggle with
this way of working.

## Install a build from GitHub

Open the [Build VSIX workflow](https://github.com/mattyv/ai-pair/actions/workflows/build-vsix.yml),
choose a successful run for the branch you want, and download its `.vsix`
artifact. Copy it to the Ubuntu host running VS Code, then install it there:

```sh
code --install-extension /path/to/ai-pair-build.vsix
```

For a local development build, the VSIX can instead be taken directly from the
shared repository folder (`/workspace/code/ai-pair` in the VM). Run the install
command on the Ubuntu host using that folder's host path.

Reload the VS Code window and restart the agent after updating. The Pair
panel's Settings dialog shows the running version and build ID, so you can
verify the loaded build. For troubleshooting, **Copy diagnostics** in
Settings copies recent connection, session, request, pause and command status
metadata to the clipboard. It does not include chat, code, paths, command text,
or output. Copying is explicit; timestamps and numeric IDs are included.

## Set up

1.  Open a project folder.
2.  Run **AI Pair: Set Up Agent** and pick your agents: Claude Code, Codex,
    OpenCode, Gemini CLI, Cursor. It adds a `pair` server to each one's
    user-wide MCP configuration. **Another agent** copies an MCP configuration
    instead: a stdio server named `pair` running `~/.ai-pair/bin/pair-mcp`
    (`pair-mcp.cmd` on Windows).
3.  Restart your agent.

## Voice status

The speaker icon beside the toolbar controls shows whether automatic narration
is off, not checked, ready, or unavailable. Hover for the reason, or select it
to open speech settings. Ready means the available cached checks passed; it
does not confirm audible sound or cloud account availability.

## Demo and diagnostics

In Claude Code, run `/pair:demo` to guide a real Pair session in a fresh scratch
file, or `/pair:diagnose` to inspect connection, command, speech and audio
status without changing settings. The legacy `/mcp__pair__demo` and
`/mcp__pair__diagnose` forms also work. The demo uses the current speech
setting; only you can confirm whether you heard it. Diagnostics alone do not
run a paid speech preview.

The extension includes the corresponding `skills/ai-pair-demo/SKILL.md` and
`skills/ai-pair-diagnose/SKILL.md`. Optionally copy their directories to your Claude
`.claude/skills` directory for `/ai-pair-demo` and `/ai-pair-diagnose`. No
skill or project configuration is installed automatically.

## Pair

Start your agent in the folder that's open in VS Code and ask it to pair ("let's
pair on..."). In Claude Code you can also run `/mcp__pair__start`.

-   **Reply:** type in the panel's reply box and press Enter. Typing pauses
    playback.
-   **Ask about some code:** select it in the editor, then reply; the selection
    goes along (**x** leaves it out). Or right-click it: *Ask the Agent About
    the Selection*.
-   **Commands:** the agent's tests and builds play in an *AI Pair* terminal.
    Choose **Run**, **Allow for session**, or **Skip** in the panel. Terminals
    stay hidden by default; use **Show terminal** or enable automatic display
    in Pair Settings. If shell integration is unavailable, the terminal opens
    so you can see and control the command. Hidden terminals are not restored
    when the workspace is reopened.
-   **Interrupt:** the button, or just edit the code.
-   **Look around:** scrolling or switching files pauses playback. **Resume**
    brings you back.
-   **My turn / Hand back:** write a part yourself while the agent navigates.
-   **The speed menu (1.0x):** the pace, from 0.4x to 3.0x, and the code
    display: Typing, Lines, or Blocks. The choice takes effect with the next
    typing action. Lines and Blocks highlight each group and pause for reading.
-   **The reading menu (read 1.0x):** the pause after each message, from 0.4x to
    3.0x. Click the reading ring to finish early, or hold it to pause the
    countdown until release. Focus it and use Space for the same behavior.
-   **AI Pair: Calibrate Reading Speed** times you on a passage and sets the
    pause after each message to your own pace.

The status distinguishes **Paused** and **Playing** from reading, command
confirmation, your turn and a suspended session. The ready count shows accepted
batches that have not started. Command results reach a waiting agent promptly.
Keep AI Pair and its Local Audio companion updated together and reload after an
upgrade. Typing handles CRLF line
endings consistently while preserving standalone carriage returns. Structural
newlines and single-close moves are explicit; other typing remains literal.

**AI Pair: Play Demo Session** shows what it's like without an agent.

## Settings

The Pair panel's **Settings** button lets you choose the chat order. The default
shows the newest messages at the top; choose **Oldest first** to put new messages
and the reply box at the bottom. Your choice is saved across reloads.

-   `aiPair.chatOrder`: newest first (default) or oldest first.
-   `aiPair.speed`: overall playback speed, the follow scroll's glide included.
-   `aiPair.readingSpeed`: reading speed, for pauses after messages and grouped
    code.
-   `aiPair.calibrationPassage`: the passage the calibration times you on;
    empty, the built-in one.
-   `aiPair.agentName`: the name on the agent's cursor.
-   `aiPair.timing`: fine-tune any typing, pause, or glide duration.
-   `aiPair.codePlayback`: `typing` (default), `lines`, or `blocks`; also in
    the code display dropdown and Settings. Changes apply to the next typing action.
-   `aiPair.showTerminalsAutomatically`: show command terminals automatically
    (off by default; also in Pair Settings).
-   `aiPair.confirmCommands`: ask before each command the agent runs in the
    terminal (on by default).
