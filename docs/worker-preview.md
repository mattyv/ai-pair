# Testing background workers

The 0.49.0 preview lets a background worker drive visible edits while the main
agent keeps the conversation and provides spoken narration. The setting is
off by default.

1.  Install the matching AI Pair and AI Pair Local Audio VSIX files and reload
    VS Code. Reconnect Pair in the agent harness so it uses the new relay.
2.  Enable **AI Pair › Worker: Enabled** in VS Code User Settings, or set
    `"aiPair.worker.enabled": true` in user `settings.json`. Set
    `aiPair.worker.model` to a model from your agent's provider to override
    the main model.
3.  Start Pair normally. Ask the main agent to create a grant with
    `worker_grant` and launch a native worker from the same provider, using
    the worker model you choose. Give the worker a small edit in a scratch
    file, such as adding one comment. The worker needs the updated Pair MCP
    server and the private grant. It does not call `start`.
4.  Watch the worker edit in the Pair panel. Ask the main agent to speak during
    the batch. It can use `worker_say` while the worker edits and `listen` to
    receive the worker's completion.
5.  Open the **Worker** tab to see the brief, edit activity, and result. Set
    how much appears in Chat to Milestones, Everything, or Off.
6.  Repeat with a longer visible edit and interrupt playback, use Cancel in
    the Worker tab, or turn the setting off. A later submission using the
    previous grant should be refused. Read the file before resuming from
    wherever playback stopped.

Use the main agent's existing session controls to close the session. Keep
the grant inside the worker's brief. It authorizes edits to the open workspace
until it is revoked. The main agent uses the harness's native delegation to
select the same provider and apply the worker model preference. AI Pair
authenticates the grant. It does not authenticate the model or launch a
separate CLI process. There is one worker and one batch at a time. Commands
use the existing Pair approval policy. A command you approved can keep running
after you cancel the worker, as with ordinary Pair commands.
