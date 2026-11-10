---
name: ai-pair-demo
description: Demonstrate AI Pair with a real, visible editing session.
---

# Demonstrate AI Pair

Call `diagnostics` first for the intended workspace. If an unrelated session is
active or suspended, defer the demo and ask the programmer to choose another
workspace or finish that session. Never take it over; do not append to or drain
its work. If session state is unavailable, stop and explain the uncertainty.
Only start a new session when diagnostics establishes that no session is active
or suspended. Follow its guide, and do not use the scripted `playDemo` command.

Using Pair `run`, resolve the physical workspace path, then use a
platform-built-in command to create an exclusively new child directory directly
inside it. Do not reuse an existing directory or follow an existing named parent
symlink. Reserve an empty
file inside that directory with an exclusive-create command that fails if it
exists. Never overwrite an existing file or automatically delete the scratch
directory. Narrate and write a short example of dependency-free code in that
file through Pair, read it through Pair, and save it. Drain only the demo's own
queued batches and check their reports. Run a
platform-built-in command through Pair that reads the saved on-disk file and
checks for a unique expected marker; inspect its output and exit code. Do not
install dependencies or change project source. Report the observed result and
scratch file location.

Select one useful short `say` with `speak: true`. This follows the current
speech setting; it does not enable speech. Ask the programmer whether they
heard it if audio confirmation is wanted. A ready status alone cannot establish
that sound was audible.

After verifying the saved marker, invite the programmer to make a small, safe edit
in the scratch file, such as change a value or a returned message. Explain
that they can skip or defer this part. To try it,
ask them to select **My turn** in the Pair panel. Call `listen` and keep
listening until the report confirms an edit by the programmer in the scratch
file, they skip or defer, or the session ends. If they edit another file, follow
their direction; do not claim the scratch edit occurred. A turn change or
message alone is not an edit; keep listening. Do not invent an edit or its
result. If they edit, use a useful
written `say` about what the report actually shows: for example, a specific
observation or suggestion. `point` at the observed change first; if needed,
read the file through Pair to locate current lines. Comment sparingly, not on
every line. You may select that `say` with `speak: true` under the existing
speech setting.

If the programmer has taken over, do not ask them to hand back or resume their
turn. Follow the guide for the programmer's turn and call `listen` while
waiting. After draining and verifying the demo, ask for permission to end the
session you created, and call `listen` for their answer. End it only when they
agree; otherwise keep listening or follow their instructions. Never end a
session you did not create. Report the observed result and scratch file location.
