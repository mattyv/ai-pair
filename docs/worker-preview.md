# Testing background workers

The worker preview lets a background worker drive visible edits while the main
agent keeps the conversation and provides spoken narration. The setting is
off by default.

1.  Install the matching AI Pair and AI Pair Local Audio VSIX files and reload
    VS Code. Reconnect Pair in the agent harness so it uses the new relay.
2.  Turn on **Enable background worker** in **Pair Settings**. Set **Codex model**
    and **Claude model** independently. Pair uses the preference for
    the active chat. A blank field uses that chat's exact model.
3.  Start Pair normally. Ask the main agent to create a grant with
    `worker_grant` and launch a native worker from the same provider, using
    the worker model you choose. Give the worker a small edit in a scratch
    file, such as adding one comment. The worker needs the updated Pair MCP
    server and the private grant. It does not call `start`.
4.  Watch the worker edit in the Pair panel. Ask the main agent to speak during
    the batch. It can use `worker_say` while the worker edits and `listen` to
    receive the worker's completion.
5.  Open **Worker** to read the helper's original responses when its harness
    forwards them. Set how much worker status appears in Pair chat to
    Milestones, Everything, or Off. Both tabs use Chat order.
6.  Repeat with a longer visible edit and interrupt playback, use Cancel in
    the Worker tab, or turn the setting off. A later submission using the
    previous grant should be refused. Read the file before resuming from
    wherever playback stopped.

Use the main agent's existing session controls to close the session. Keep
the grant inside the worker's brief. It authorizes edits to the open workspace
until it is revoked. The main agent selects the same provider and applies
the worker model preference. The harness can launch its own worker or use
the Codex runner below. Pair authenticates the grant, and the launcher
supplies the requested model. There is one worker and one batch at a time. Commands
use the existing Pair approval policy. A command you approved can keep running
after you cancel the worker, as with ordinary Pair commands.

The previous single `aiPair.worker.model` setting remains in existing
settings files. If you used it, copy it once to the appropriate provider
field. Pair cannot tell which provider the shared value belonged to.

## Showing text as Codex writes it

Use the launcher's `worker-run codex` command from the workspace where
the worker should run. Feed it two JSON lines on stdin, first the private
grant, then a task record with the resolved `model` and `prompt`. Resolve
the model from the grant when present and use the main chat's exact model
otherwise. Keep both records in owner-only files.

```bash
{
  cat "$pair_worker_grant_file"
  cat "$pair_worker_task_file"
} | "$pair_launcher" worker-run codex
```

This starts an ephemeral Codex App Server turn using the current Codex
sign-in. The runner forwards each public response update as it arrives,
then completes the grant after the turn. Give the worker its normal Pair
tool instructions and leave `worker_done` to the runner. The runner keeps
Codex's native workspace access read-only, while Pair applies approved
visible edits through the existing grant. Cancel immediately revokes that
grant. A silent Codex process observes the revocation on its next output
attempt or the runner deadline.

## Forwarding completed responses

For Codex CLI workers, pass the grant JSON on the first line of stdin to
the Pair launcher, then pipe the worker's `codex exec --json` output. Use
a private grant file and the same workspace selected by the main agent.
Set `pair_worker_model` to the grant's model or, when absent, the exact
model of the main chat. With the launcher, grant, and prompt paths set locally:

```bash
{
  cat "$pair_worker_grant_file"
  codex exec --json -C "$pair_worker_workspace" -m "$pair_worker_model" - < "$pair_worker_prompt_file"
} | "$pair_launcher" worker-transcript codex
```

Write the grant file with one trailing newline and access restricted to
its owner. Keep the worker prompt and grant private and remove any temporary
handoff after use. The adapter reads completed public assistant messages,
forwards their text, then completes the grant after the stream ends. The
worker omits `worker_done` when using this adapter. If an input record or
response exceeds the forwarding limit, the adapter reports an incomplete
transcript and keeps the responses it already forwarded.

With a different harness, forward each public response using `worker_output`
with the worker's grant, before `worker_done`. Pair receives only responses the
harness forwards. The Worker tab displays that text as plain text.
