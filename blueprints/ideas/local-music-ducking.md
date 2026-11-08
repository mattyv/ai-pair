# Optional local music ducking plan

Prepared from current worktree sources and upstream docs on 2026-11-08. This is
a plan, not a verified backend implementation. No real host audio was touched.

## Product contract

Disabled by default. UI-local setting: enabled plus remaining background level
(for example 30 percent), explicitly labeled as remaining level rather than
amount reduced. Keep this separate from the speech loudness control. The local
companion owns settings and operation even with a remote workspace. Speech still
works when ducking is unavailable; report the fixed capability reason locally.
Never fall back to device/master volume changes. Never change mute or channel
balance. Exclude AI Pair output by strong per-process/per-stream ownership, not
an application display name alone.

Ducking begins only after the current physical part starts; release on pause,
physical completion, failure, stop, disabled setting, page retirement, detected
workspace disconnect, and companion teardown. Unduck between parts if synthesis
leaves a gap. Resume requires a fresh valid owner and proof that playback
resumed. Old asynchronous acquire completions must release themselves when
canceled. Disconnect detection is delayed by the heartbeat bound, not
instantaneous.

## Verified constraints and recommended next action

Current LinuxBackend uses NativeOutputDriver/pw-play with SIGSTOP/SIGCONT and a
streaming marker. It has no confirmed OS pause/resume acknowledgement. Do not
invent such an acknowledgement in the ducking layer.

PulseAudio implements module-role-ducking with a separate internal volume
factor. Upstream stream-interaction.c adds/removes that factor, reacts to
cork/unlink, and excludes trigger roles. This is a sound foundation for
preserving independently changed application volume. PipeWire Pulse emulation
does NOT list this module and cannot load external PulseAudio modules. Thus
detecting pactl is insufficient and native pw-play cannot simply be assumed to
trigger a separate PulseAudio server's role policy.

WirePlumber stream.restore-props/state.restore-props control restoration of
application volume/mute/channel map across stream creation. They are not a
reversible ducking factor or transaction. Do not disable the user's global
restore policy. PipeWire channelVolumes writes change the user-facing volume and
do not offer compare-and-swap. Read/scale/conditional-restore has a race with
user changes, even when restore first compares to the last written value. Do not
claim that design preserves concurrent adjustments.

Immediate useful Ubuntu experiment: use a private PipeWire + WirePlumber +
pipewire-pulse server with private runtime/config/state directories, dummy sink,
two generated test streams, and captured sink PCM. Test whether stream Props
softVolumes gives an independent multiplicative factor while user volume changes
via pactl and wpctl affect channelVolumes. Inspect installed
implementation/source first: a listed SPA property alone does not prove it is
writable, independent, or owner-scoped. Measure PCM gain, channelVolumes,
softVolumes, and persisted state across writes, pause, stream recreation, server
restart, helper SIGKILL and parent loss. Compare against a control run. Never
point this experiment at the host socket. No ALSA nodes, no host session
manager.

If softVolumes is overwritten/derived/shared (plausible), reject that route. The
next candidate is a dedicated ephemeral PipeWire gain/filter path or WirePlumber
role-policy loopback, where ducking gain is separate from application volume.
Prototype fail-open routing after filter/helper death BEFORE adopting it: a
filter disappearing can leave applications disconnected instead of restoring
sound. WirePlumber's current documented role policy requires configured
loopbacks and may not exist in the user's installed Ubuntu version; setting
media.role alone does not enable it. Do not install a global WirePlumber policy
as an incidental extension setting.

## Independent Terra ownership

1.  New files only now: specs/LocalAudioDucking.tla, its normal/mutation cfg
    files; packages/audio-native/src/ducking.ts and test/ducking.test.ts;
    packages/audio-native/src/ducking_capability.ts and
    test/ducking_capability.test.ts;
    packages/audio-native/test/ducking.integration.test.ts. Own a pure lifecycle
    controller and explicit capability vocabulary. Keep capability unsupported
    until an actually verified mechanism is selected. Do not edit
    native_adapter.ts, companion_output.ts, speech_service.ts, speech_host.ts,
    or shared settings yet. Tell root required spec README table additions
    rather than competing on that shared file.
1.  Independent private-server experiment fixtures:
    packages/audio-native/test/ducking_pipewire.integration.test.ts and narrowly
    named test fixtures. Terra can run the experiment above and return evidence;
    production writes remain gated. Pulse factor prototype can use new
    linux_pulse_ducking.ts plus its solitary/integration tests, but is an
    optional backend, not an answer to Ubuntu PipeWire by itself. Require
    same-server speech-trigger identification and crash/cork verification before
    capability becomes supported.
1.  After native/output owners finish: integrate the controller at confirmed
    physical lifecycle seam; native owner supplies active/paused/resumed/closed
    observations with owner+part identity. Host owner wires local-only
    preferences and status. Root owns shared schema/index export changes,
    DECISIONS.md, docs, architecture model/exports, and thresholds/coverage
    tables to avoid collisions.

Suggested ducking interface: capability(): `Promise<supported/reason>`;
acquire({owner, part, remainingLevel}): `Promise<handle>`; handle.release():
`Promise<void>`. Release must be idempotent. A lease token identifies the exact
mechanism instance; never release by global module name or an old recycled
stream ID. Controller states idle/acquiring/active/releasing; epoch invalidation
handles late acquire and duplicate terminal callbacks. Consider one serialized
operation queue to prevent old restore overtaking a new acquire. Backend
failures are contained and locally reported without canceling narration.

## Model first and meaningful failing tests

Model external user-volume changes, physical activity, ownership epoch, part,
enabled flag, delayed acquire/release, helper loss and server loss. Invariants:
no own-stream/master mutation; no active gain without live authorized speech;
user base volume unchanged by acquire/release; stale owners cannot
acquire/release current gain; successful current start eventually attenuates
when supported; inactive/disconnected eventually returns gain to unity under
stated backend availability/fairness. Distinguish transient pending restoration
from a false instantaneous invariant. Prove each invariant bites with mutations
and map to named tests before runtime implementation.

TDD cases: disabled/unsupported are zero mutations; preparation and admission do
not duck; real part start acquires once; stale start rejected; pause releases;
verified resume reacquires; end/stop/failure/dispose/disconnect release exactly
the owned factor; pending acquire after cancel releases; repeated release is
harmless; user changes base volume during attenuation survive release; stereo
imbalance and mute preserved; AI Pair stream excluded; new unrelated streams
handled by declared policy; recycled identity never restored; backend rejection
does not break speech. Test level update while speaking with defined
serialization, not stacked factors. No shell interpolation of stream names.

Integration must run real private server/client processes and measure output,
not just mocked command arguments. Cover pipewire-pulse and native PipeWire
target streams separately if both are claimed. Prove parent/helper crash and
disconnect cleanup and retained user volume on private PCM capture. Model power
loss/server death separately: absent server means no audible persistent
attenuation, but saved stream properties can poison the next session. No
100-percent recovery promise for SIGKILL based only on finally/dispose. A
watchdog that shares the same failure domain does not prove recovery;
ownership-scoped server-side factors are preferable.

## Review and verification

Astra reviews model, backend semantics and races before advertising support. Run
targeted TLC plus mutation checks, solitary unit coverage and true integration
coverage for every changed source, typecheck/lint/format, package build and
required repository checks. Existing legacy coverage failures remain separately
reported; do not lower floors. Record material choice and limitations in
DECISIONS.md, keep issue working notes, update .archi source and generated
exports if backend/helper adds architecture, and verify exports using repository
workflow.

## Effort and decision gate

Controller/model/capability scaffolding is a bounded independent task,
approximately 1-2 hours including review and targeted checks. A private-server
gain/volume experiment is approximately 30-90 minutes after prerequisites are
available. A production PipeWire filter/policy helper is materially larger
(potentially a day or more); exact effort depends on crash-restoration evidence,
installed versions, packaging and coverage. These are planning ranges, not
completion guarantees. Do not mark the requested Ubuntu feature complete with
unsupported settings alone. The next decision is based on private-server
evidence: adopt a proven independent gain mechanism, or report the specific
unmet guarantee and implement the next prototype.

## Primary references

-   https://docs.pipewire.org/page_pulse_modules.html (supported emulated
    modules, external module limitation).
-   https://raw.githubusercontent.com/pulseaudio/pulseaudio/master/src/modules/stream-interaction.c
    (volume-factor application/removal and cork/unlink hooks).
-   https://wiki.freedesktop.org/www/Software/PulseAudio/Documentation/User/Modules/
    (role ducking parameters).
-   https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/stream.html
    (restore-props purpose).
-   https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/settings.html
    (role policy and duck-level).
-   https://raw.githubusercontent.com/PipeWire/wireplumber/master/src/config/wireplumber.conf.d.examples/media-role-nodes.conf
    (explicit loopback requirements).
-   https://docs.pipewire.org/props_8h_source.html (SPA volume property
    declarations; not an independence guarantee).

## Private PipeWire experiment results, 2026-11-08

Terra tested PipeWire 1.4.2 and WirePlumber 0.5.8 using isolated runtime,
configuration, state, generated streams and null sinks. No host device or shared
audio socket was used. These findings reject candidates; they do not establish
a supported backend.

-   Setting `softVolumes` to 0.3 initially reduced captured RMS from 4471.78
    to 1341.51. After a user-facing Pulse volume change to 60 percent, RMS was
    965.86, matching the new cubic channel volume alone rather than the product
    with the ducking factor. Property dumps still showed both values. Property
    independence therefore did not establish independent effective gain.
-   The `softVolumes` setting survived the writer process exiting. It was not
    an ownership-scoped factor with automatic crash restoration.
-   Removing an ephemeral loopback restored a default-routed stream to the
    default sink. The negative control started on a second explicit sink: after
    helper SIGKILL, audio moved to the default sink instead of its original
    destination. The original target property survived, so metadata alone did
    not prove routing preservation.

The experiment scripts and raw evidence are temporary local artifacts under
`/tmp/duck-private/`. All private test processes were cleaned up. No production
backend or settings capability was added from these rejected approaches.

## Private PipeWire study, 2026-11-08

A loopback virtual sink study ran only on a private PipeWire 1.4.2,
WirePlumber 0.5.8 and pipewire-pulse stack with null sinks, never on the user's
audio. Results that held: independent multiplicative gain (a 0.3 duck times a
60 percent Pulse volume gave 0.3 x 0.216 of the baseline RMS, not the
`softVolumes` failure), stream volume, mute and balance unchanged and identical
after a helper kill, fail-open return of eligible streams, explicit-target
streams never moved, a user move to another output respected, and the
playback side following a default-sink change only when it has no fixed target.

Eligibility needs a node without `target.object` and no default-metadata
`target.node` or `target.object` (or -1), and exclusion of AI Pair's own
stream by process identity. A unique virtual sink name per helper is required:
a fixed name let a stale persisted WirePlumber target capture a later stream,
including AI Pair's own speech.

Blocking findings: moving a stream persists a target in the user's WirePlumber
state and a crash leaves stale entries; a user's concurrent move can be
overridden in a window of milliseconds; glitch on move is unmeasured; the
subscribe or poll loop was never built; stock distribution configuration, real
hardware, Bluetooth, Pulse-only servers, macOS and Windows are untested or have
no mechanism. The feature remains deferred. The raw scripts and numbers were
kept under `/tmp/duck-scope` on the build machine and are not part of the
repository.
