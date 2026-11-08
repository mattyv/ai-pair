# Changelog

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
