# AI Pair

## Additions in this fork

This fork builds on the original [AI Pair project](https://github.com/faiface/ai-pair).
The changes in version 0.14 include:

-   Choose the order of the conversation and read clearer message text.
-   See clearer pause and playback status; click the reading indicator to finish
    its timer, or hold it to pause the timer.
-   Choose typing, line, or block playback, and control its speed. In 0.14,
    these choices are in the pace menu.
-   Keep command terminals quiet by default and reveal an available run when needed.
-   Copy session diagnostics for troubleshooting and find the running version and
    build in Settings. GitHub Actions provides downloadable extension builds.

The next release is being developed with a separate code-display dropdown,
more readable Settings, and optional local spoken narration. These additions
are not yet available in the 0.14.1 release.

[Download a fork build from GitHub Actions](https://github.com/mattyv/ai-pair/actions)
(run **Build VSIX**, then download its artifact). The Marketplace link in the
original README below installs the upstream version without these additions.

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
confirmation, your turn and a suspended session. Typing handles CRLF line
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
