# Native audio helper protocol

The extension launches only a helper packaged for its operating system and
architecture. It never accepts a command or executable path from a webview or
other untrusted input. The helper communicates over dedicated standard input
and output pipes; standard error is not forwarded as a diagnostic.

A session owns at most one output job. Input and output are bounded UTF-8 JSON
lines. Admission validates and snapshots an explicit endpoint, resolving a
default choice to a concrete endpoint. The playback helper rechecks and opens
that same endpoint, then reports `ready`. Device identifiers are opaque data,
never shell fragments. Enumeration is separate from playback and never
synthesizes speech. A selected device must be opened exactly; a missing or
lost device fails the job rather than falling back to another device. Default
output is an explicit choice. Playback carries a bounded WAV payload. Controls
address the current job, and stale controls cannot affect a later one.

Output events carry protocol version 1 and an increasing helper-event
sequence, independent of host control and heartbeat sequences. They have only
the fixed types `ready`, `started`, `paused`, `resumed`, `ended`, `canceled`,
`failed`, and `retired`. Malformed, oversized, or unexpected messages fail
closed. `ended` means the native playback queue has drained; it is not a claim
that sound was physically audible. `retired` is reported only after the native
output has stopped and resources are released. Host ownership remains held
until retirement or process close. EOF on the host's control pipe starts
asynchronous retirement, including while paused; it does not itself prove that
retirement has finished. Startup, control, and shutdown are bounded; a timeout
never grants permission to overlap a still-live helper.

The implementation and tests must establish these guarantees on the relevant
native hosts. Passing compilation on a cross-compiler alone does not
demonstrate device selection, device-loss behavior, or audible playback.

Discovery runs in a separate invocation and returns one bounded response with
up to 64 output devices; each opaque ID and label is bounded independently.
The response is used only for the output chooser and is never included in
diagnostics. Logical admission happens before speech synthesis; the playback
helper starts afterwards and remains alive for one job, so the host can
associate its private event sequence with the immutable connection, job, and
page owner. If an endpoint disappears after admission, synthesis may still
incur provider cost, but playback must fail rather than use another endpoint.
The host's control-message sequence is separate. The host sends the selected
endpoint as data, followed only after admission by one WAV payload, bounded by
the existing 1,948,844-byte speech limit. Pausing must never suspend the
helper's input reader.

## Wire messages, version 1

The host invokes only a packaged fixed executable with one fixed argument:
`--list` or `--play`. No device ID or arbitrary path appears in its command
line. All lines use UTF-8 and end in a newline.

`--list` outputs one JSON line `{ "version": 1, "devices": [{ "id": "...",
"label": "..." }], "defaultId": "..." }` then exits. `defaultId` can be null.
There are at most 64 devices; each ID is at most 512 UTF-8 bytes, each label
at most 256, and the complete line at most 65,536 bytes. Only output endpoints
are listed.

`--play` reads these JSON lines, each with `version: 1` and a contiguous host
command `sequence` starting at zero:

-   `open`, sequence 0, includes `id`, the concrete endpoint snapshot. The
    helper opens that endpoint, emitting `ready` only after success. Never
    substitute another endpoint.
-   `play`, sequence 1, includes `wav`, the base64 complete WAV, limited to
    1,948,844 decoded bytes. It is valid only after `ready`.
-   `pause`, `resume`, and `stop` contain no additional fields. The reader
    remains responsive when paused.

The event lines are `{ "version": 1, "sequence": n, "type": "..." }`, with a
separate contiguous helper event sequence starting at zero. The event types
are `ready`, `started`, `paused`, `resumed`, `ended`, `canceled`, `failed`,
and `retired`. Natural `ended` is emitted only after the operating-system
queue drains. Failure produces `failed`; cancellation produces `canceled`.
`retired` follows release of the native stream. A failed process or failed
`stop` never proves retirement; the host retains ownership until an actual
close notification. EOF initiates asynchronous cleanup, including while
paused. Stderr is never forwarded as a diagnostic.
