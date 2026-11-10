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
directory. Narrate and edit that file through Pair, read it through Pair, and
save it. Drain only the demo's own queued batches and check their reports. Run a
platform-built-in command through Pair that reads the saved on-disk file and
checks for a unique expected marker; inspect its output and exit code. Do not
install dependencies or change project source. Report the observed result and
scratch file location.

Select one useful short `say` with `speak: true`. This follows the current
speech setting; it does not enable speech. Ask the programmer whether they
heard it if audio confirmation is wanted. A ready status alone cannot establish
that sound was audible.

After draining and verifying the demo, end the session you created and report
the result. If the programmer has taken over, do not end it: explain what is
left and follow the guide for the programmer's turn. Never end a session you
did not create.
