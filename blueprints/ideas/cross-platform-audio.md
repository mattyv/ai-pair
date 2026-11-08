# Cross-platform local audio: implementation contract

Work only in `/workspace/code/ai-pair/.claude/worktrees/17-cross-platform-audio`,
starting from checkpoint `7b38dde`. Preserve the carried MCP guidance and feedback.
This phase changes audio location and output adapters. Sentence pipelining,
pitch-preserving rate changes and a new common synthesis-worker protocol follow
only after this phase passes review and verification.

## Placement and packaging

Ship two independently installable VSIX files: existing AI Pair and an optional
AI Pair Local Audio companion with `extensionKind: ["ui"]`, `api: "none"`.
Do not add a hard Marketplace dependency. Document installing the companion
locally, including in SSH/WSL/container windows, then reloading the window.

The workspace extension retains controller, editor, filesystem, relay, command
approval execution and session persistence. The companion owns the Pair webview,
SpeechService, credentials, speech/output preferences and native audio. This is
essential: keeping the webview's message handler remotely would send a local
reply/stop over SSH before it could silence audio.

Use one panel owner per window. Before registering a panel provider, main attempts
a bounded, versioned command handshake with the companion. On accepted attachment,
the companion registers the existing Pair view provider; main registers none and
uses a PanelPort proxy. The main extension continues contributing the view in its
manifest. The companion must not register that provider before attachment. Test
this cross-extension contribution/provider registration in native VS Code first.
If VS Code rejects that arrangement, move the view contribution into a tiny shared
UI installation contract; do not silently create duplicate Pair panels.

When the companion is absent, local main keeps its reviewed legacy panel/speech
path; remote main keeps text functionality and shows speech unavailable with the
local-install action. It must never start audio on the remote machine. Do not
transfer a live panel when the companion is installed; reload is the supported
transition. Once companion mode is selected for a window, a later companion failure
must not start a second legacy audio owner.

Package backend executables built in CI, with platform/architecture and protocol
manifest plus SHA-256. No compiler, SDK, .NET installation or shell package install
on the user's machine. Keep the existing Linux runtime assets available to the
companion through shared build inputs, not a dependency on another installed
extension's private directory. Reuse source modules; do not fork SpeechService.
Preserve old local credentials without copying secrets over the workspace bridge:
offer a local masked-key re-entry if extension-scoped SecretStorage migration is
not available. Do not read another extension's secret store.

## Shared contracts

Expose one local adapter boundary:

-   `capabilities()` returns backend, UI-local location, default-output support,
  explicit-device support and pause/resume support. Missing helpers/devices yield
  truthful unavailable results.
-   `list()` returns bounded output IDs and display labels. Persist the selected
  backend and opaque device ID in the companion's local unsynced globalState.
  IDs are not array positions. A saved ID that no longer resolves stays unavailable.
-   `admit(owner, choice)` reserves the exact route before provider dispatch. Owner
  contains connection epoch, job ID and page epoch. The returned lease is opaque.
-   `play(lease, wav)` accepts the existing bounded complete PCM WAV and produces
  started and one terminal outcome: natural ended, canceled or failed.
-   `pause`, `resume`, `stop` target the exact owner. Stop settles only after actual
  stream/process retirement. Failure must retain ownership until retirement too.

Never fall back from an explicit device to default. Recheck device availability
at opening/playback and report removal as failure. System default means resolving
the current local system default for that job; snapshot it for the job rather than
silently following another endpoint mid-speech. Device labels/IDs stay out of
diagnostics. No microphone permission or input enumeration is needed.

Workspace/companion communication uses private VS Code commands and plain JSON,
not exported extension APIs, localhost servers or shell tunnels. Frames include
protocol version, connection epoch, sequence and relevant job/page IDs. Handshake
capabilities determine availability; never infer local OS from remote process.os.
Keep text and waveform bounds already enforced by speech. Commands are a narrow
allowlist; no arbitrary executable, filesystem path or callback name is accepted.
The epoch is stale-work protection, not a security boundary against other extensions.

Main forwards session panel events and narration requests. Companion returns
panel actions to a fixed main command. Main's NarrationPort becomes a proxy whose
promise settles on matching terminal acknowledgement; controller's reading clock
and approval gates remain unchanged. Companion performs local reply/hide/provider/
output cancellation before forwarding the related workspace action. Pause reasons
must still compose; clearing one reason cannot resume another reason's pause.

Use a bounded connection lease/heartbeat while attached. Remote loss is detected
after lease expiry, not instantly: the companion then stops locally and rejects
late frames. Local panel disposal also stops locally. On companion death, native
helpers stop on parent/pipe loss. Reconnection gets a new epoch and never replays
old speech. No setting change, key or audio enters session history.

## Platform backends

Linux: adapt the reviewed pw-dump/pw-play PipeWire implementation, preserving its
explicit-target/no-fallback flags, stopped-child cleanup and close acknowledgement.
Add native System default through an explicitly resolved local sink. Preserve the
legacy browser default only in the no-companion compatibility path.

macOS: a small Swift executable using CoreAudio device enumeration and AudioQueue.
Use the device's UID with kAudioQueueProperty_CurrentDevice; pause/resume with
AudioQueuePause/Start; immediate stop for cancellation; natural end through queued
data drain and AudioQueueStop(false)/IsRunning observation. All device operations
run outside the real-time callback. Do not report completion merely because the
last application buffer was submitted.

Windows: a small C++ executable using WASAPI shared mode. Enumerate render endpoints
and open the exact IMMDevice ID; use the selected/default endpoint explicitly.
Pause with IAudioClient.Stop, resume with Start, and reset/dispose on cancellation.
Natural end requires all source frames submitted and engine padding drained before
retirement. This confirms API-level drain, not physical audibility. Device IDs can
change after reinstall/driver changes; unresolved saved IDs fail closed. Do not
require the Windows 11-only StableId property. Treat endpoint invalidation as failure.

Prefer these narrow native adapters over a general miniaudio migration now: they
preserve the proven Linux backend and make device loss/drain semantics explicit.
Helpers use bounded versioned framing over private pipes, a control thread that
remains responsive while paused, and no audio files. Parent death/EOF must retire
playback; validate this with real processes on each OS. Native backend owner chooses
the smallest checked framing implementation and publishes it before integration.

Cross-platform playback does not expand Kokoro synthesis support: the packaged
Kokoro runtime remains Linux x64/glibc until separately implemented and verified.
ElevenLabs synthesis and its SecretStorage key run in the local companion, including
remote workspaces. The companion never sends that key to the workspace extension.

## Two Terra implementation owners

Terra A: main/UI integration and transport. Own `packages/audio-ui/**`, new shared
audio protocol types/tests, main `extension.ts`/panel bridge, panel messages/webview,
SpeechService adapter wiring, local preferences and credential UI. Reuse existing
speech modules and preserve all default/off, text visibility and one-unit gates.
First prove a synthetic two-extension local/remote command roundtrip and single
panel ownership before moving production wiring. Coordinate on the adapter types
with Terra B before editing shared files.

Terra B: native adapters and packaging. Own `packages/audio-native/**`, helper
protocol implementation/tests, platform build scripts, platform artifact manifest,
and the adapter-facing Linux driver extraction. Implement native lifecycle tests
before production. This owner also integrates CI platform builds, coordinating
workflow edits with root. Existing unrelated runtime fixes remain untouched.

Root: integration coordination, final docs/version/Archi review and release gates.
All production code and tests are written by Terra; Astra reviews models and source.
Formal-model Terra can hand off after model approval to free the
implementation slot.

## Spec and verification gates

Extend existing output models with local connection ownership, immutable route
snapshot, truthful capabilities, pre-synthesis admission, local pause reasons,
detected network loss, late callbacks and parent death. Explicitly model physical
child/stream ownership separately from UI status. Invariants: no remote playback,
no fallback, one live owner, no stale restart, no canceled natural end, no
secret in transport and no reading/approval release. Liveness assumes fair local
processing and eventual failure detection; timeout settles callers without freeing
the output. Mutations must disable each important guard and useful action.

TDD covers malformed/oversized frames, reordered messages, lost acknowledgements,
reconnect, device disappearance, saved stale IDs, queued stop, paused parent death,
and provider dispatch denied before admission. Use synthetic PCM only: no live
cloud credit or user microphone/audio-device changes for tests.

CI builds Linux x64, macOS arm64/x64 and Windows x64/arm64 executables and both
VSIXs.
Cross-compiled artifacts still need execution validation on the corresponding host;
do not describe a successful cross-build as native playback verification.
Extracted-package tests must resolve helpers without checkout dependencies.
Mock lifecycle coverage does not prove native audio: run actual helper default and
explicit-device tests on each supported OS with available virtual/real output,
including drain, pause/resume, missing/removed endpoint and parent death. If hosted
CI lacks a device, report that test as unavailable and use a suitable runner before
claiming platform verification; compilation alone is not completion.

An isolated SSH/Dev Container test must demonstrate that the workspace process is
remote while the companion/helper PID and device list are local, and that a local
reply stops audio during a deliberately delayed/disconnected remote channel.
Native test completions establish functional routing, not the user's heard quality.

## Primary references

-   VS Code remote extension placement and command routing:
  https://code.visualstudio.com/api/advanced-topics/remote-extensions
-   VS Code extension-kind placement:
  https://code.visualstudio.com/api/advanced-topics/extension-host
-   AudioQueue device UID:
  https://developer.apple.com/documentation/audiotoolbox/kaudioqueueproperty_currentdevice
-   AudioQueue drained versus immediate stop:
  https://developer.apple.com/documentation/audiotoolbox/audioqueuestop(_:_:)
-   AudioQueue property completion callback:
  https://developer.apple.com/documentation/audiotoolbox/audioqueuepropertylistenerproc
-   WASAPI stop/resume:
  https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-stop
-   WASAPI queued frames:
  https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-getcurrentpadding
-   Endpoint invalidation:
  https://learn.microsoft.com/en-us/windows/win32/coreaudio/recovering-from-an-invalid-device-error
-   Windows StableId scope:
  https://learn.microsoft.com/en-us/windows/win32/coreaudio/pkey-audioendpoint-stableid
