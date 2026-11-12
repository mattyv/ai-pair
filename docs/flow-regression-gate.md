# Scripted agent flow gate

Run `npm run test:flows` before releasing changes to session flow. The normal
Vitest suite includes these tests too; this command provides a focused local
check without a model account or paid provider calls.

The fake agent is a scripted MCP SDK client. It connects through the real
relay server, editor WebSocket bridge, controller and player. Editor effects,
commands and narration are controlled test doubles. Companion-control tests
also compose the real panel routing and session owners.

| Flow | Evidence |
| --- | --- |
| Batched work and programmer messages or edits | Eight fixed seeds exercise two event orders and distinct payloads. |
| Pipelining | Two nonempty batches wait behind controlled narration; progress resumes when its completion is released. |
| Waiting | Pending listens wake on an event; a paused drain stays held until resume. |
| Cancellation | A canceled MCP listen does not lose the reply recovered by the next call. |
| Speech failure | A rejected narration effect settles and later work progresses. |
| Speech modes | Continue-mode narration permits typing; a later wait-mode question stays ordered and a pending listen receives the reply. |
| Commands | Approval holds a command; revocation makes the next command prompt; results are delivered once. |
| Reconnection | An editor WebSocket drop suspends Pair and a new connection resumes it. |
| Stale effects | A predecessor's late narration completion cannot change the replacement session. |
| Persistence | Revoked grants remain cleared after restoring the session; stale companion pages cannot revoke a successor. |

Every scripted MCP operation has a deadline. A failure includes its seed and
the script/transport trace. Negative tests deliberately withhold an effect
and confirm that the gate detects the blocked operation before releasing it
and checking recovery. A timeout in a deliberately held approval, pause or
speech effect is evidence of that hold, not proof of a product defect.

These cases complement bounded TLA+ checks of delivery, narration, command
approval and session ownership. They do not enumerate every possible
interleaving. Eight seeds cover two event orders, not eight independent
state-space explorations. The tests do not verify a real LLM's instruction
following, actual provider behavior, audible output or hardware drivers.

The separate `test:integration` command runs inside isolated VS Code and
includes a real stdio MCP client. Packaged-extension checks must name the
artifact tested. Passing this fake-agent gate alone is not evidence that the
real-editor or packaged integration suite ran.
