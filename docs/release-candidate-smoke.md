# 0.34.0 local candidate smoke test

Install both candidate VSIX files, reload the VS Code window, and reconnect
Pair MCP. Enable speech with your usual provider and output. Start a fresh
Pair session if you want to test a subtotal without unknown earlier costs.

Paste this request into your coding agent:

> Run an AI Pair 0.34.0 smoke test in a new scratch text file inside this
> workspace. Do not overwrite an existing file. First use a short `say` with
> `speech_mode: "continue"`, then type a few short lines while it speaks.
> Keep the normal reading pause. Next send a short question using the default
> wait mode, and call `listen` for my answer. Do not continue until I answer.
> Keep Pair open throughout; do not return a final conversational answer or
> call `end` unless I explicitly ask you to end the session.

Check these observable behaviors:

1.  Typing starts after the normal reading pause and before the first voiceover
    ends. The next spoken question starts after that voiceover ends, and its
    answer is received by the agent.
2.  Muting narration stops the voice without taking your turn or stopping the
    editing session. Re-enable it and ask for another short spoken message.
3.  During another continued voiceover, send an interruption or pause playback.
    No old narration should restart after you resume or start a fresh session.
4.  In Settings, inspect Commands. If you choose Allow all for session for a
    harmless command, Require command approval must clear that permission and
    make the next command prompt again. A command already running continues.
5.  With OpenRouter, check the compact subtotal beside the voice icon. Hover or
    focus it for the precise amount and missing-cost reasons. An asterisk means
    the subtotal is incomplete; previews are excluded.
6.  Ask to end the session while a continued voiceover is playing. Remaining
    audio should stop. Pair must not end itself at an earlier natural pause.

If a step fails, copy diagnostics before changing speech settings, and note
the step, provider, selected output and whether the session was restored.
The checks above require human observation; automated readiness does not
prove that audio was heard.
