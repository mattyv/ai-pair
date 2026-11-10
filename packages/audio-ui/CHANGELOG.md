# Changelog

## 0.24.1

-   Restore a saved speech output device on startup without opening Settings,
    while preserving missing-device reporting and shutdown safety.

-   Clarify speech model and compute settings, with technical details collapsed.

## 0.24.0

-   Provide read-only audio status for AI Pair diagnostics without exposing
    keys or narration.

## 0.23.2

-   Correct distorted GPU voice output by routing one affected model operation
    through the CPU while keeping the remaining GPU checks and computation.

## 0.23.1

-   Fix GPU worker communication when VS Code and its bundled worker use
    different Node and V8 versions.

## 0.23.0

-   Add experimental local Kokoro GPU setup with a separate pinned model,
    physical-device checks, and a guarded isolated inference worker. CPU
    remains the default. Physical AMD hardware validation is pending.

## 0.22.1

-   Show a more specific, safe reason when ElevenLabs narration fails and
    include its failure category in copied speech diagnostics.

## 0.22.0

-   Show queued work alongside the current pairing status.
-   Require compatible private connection versions for the panel and audio.
    Update both extensions and reload after upgrading.

## 0.20.1

-   Verify local Kokoro platform support using bounded evidence from the running
    process when Node's system report is unavailable. Keep unsupported or
    unverified hosts blocked, with a more specific diagnostic reason.

## 0.20.0

-   Pipeline local Kokoro narration as bounded sentence parts while retaining
    one displayed message, reading clock and concrete output route. Hold unit
    completion until the final playback process retires. ElevenLabs retains
    one synthesis request per narration.
-   Add an experimental **Listening speed** (0.75 to 1.5, default 1) processed
    in a local worker before playback, with no extra cloud request and no change
    to the audio at 1. Listening quality at other rates has not been validated
    by people. The companion packages the tempo worker for every platform.
-   Run local Kokoro behind a versioned warm-worker protocol: the model stays
    loaded between narrations, stale or late worker responses are rejected,
    canceled narrations are never replayed, and a replacement worker starts only
    after the previous one has exited.

## 0.19.0

-   Add the optional UI-local panel and audio companion for AI Pair.
-   Keep speech credentials and output selection on the local client, including
    when the workspace runs remotely.
