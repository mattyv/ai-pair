# Next speech increments after cross-platform audio

Plan baseline: approved cross-platform audio checkpoint c036b02. This is an
implementation plan, not an implementation or a release verdict. The user
authorized work on these increments while the previous integration gates remain
open. Implement them in an isolated branch, preserve those gates before merge,
and deliver the three increments in the requested order.

## Product contract retained throughout

-   One explicitly selected MCP narration unit at a time, at most 280 Unicode
    characters and 45 words. No new backlog, automatic narration of all chat,
    filler, or speculative future MCP actions.
-   Show the complete selected text before speaking. Keep one history entry and
    one reading countdown for the unit. Sentence boundaries are internal; they
    do not create additional chat entries or advance code.
-   The existing Player waits for reading and speech concurrently, then observes
    global pause. Preserve that behavior: completion takes the longer
    opportunity, not the sum of separate reading and speech sleeps. Speech never
    completes a held reading clock, skips code, or approves a command.
-   Reply, interruption, provider/key/output changes and page/connection loss
    cancel current speech. A stale result cannot restart it. Audio ownership is
    released only after actual physical retirement; a timeout is not retirement.
-   All synthesis, credentials and audio stay in the local UI host when the
    companion owns the panel. Workspace transport still carries selected text
    and bounded metadata, never keys or PCM.
-   No persistent audio/text cache. Keep the already-loaded model warm, and
    retain only bounded buffers for the current unit.

## 1. Sentence pipeline within an admitted unit

### Smallest useful deliverable

Pipeline Kokoro sentences in the local companion. Keep ElevenLabs as one
existing synthesis request per admitted unit and keep the legacy output path as
one waveform. Expose this as a capability internally, not a misleading promise
that every provider streams sentences. This delivers earlier first sound without
changing paid request counts, native helper wire protocols, the MCP contract, or
the human reading clock.

The first part plays while at most one following part is being synthesized or
held ready. There is only one inference request in flight. Start lookahead only
after the preceding part actually starts and only while unpaused. Lookahead is
confined to text already displayed and admitted; it never crosses into another
narration unit.

Split with Intl.Segmenter sentence boundaries and retain exact source ranges.
Coalesce excess segments into the final part so there are at most four parts. A
single sentence, uncertain segmentation, or unavailable segmentation stays one
part. The concatenation of all ranges must equal the original text, including
punctuation and whitespace. Do not replace acronyms, rewrite pronunciation, drop
code-like text, or truncate tokens as part of this change. Keep the existing
model vocabulary/token validation on every request.

Apply the current 40-second spoken-audio limit to the aggregate unit, not
independently to four parts. Keep the 600 ms thinking tail once, on the final
part only. The current waveform encoder appends that tail to every request, so
this must be an explicit tested change. If a later part fails or would exceed
the aggregate limit, stop the remaining unit and show a fixed text fallback;
never replay earlier parts or retry a provider automatically.

### Output reservation is the important change

NativeAdapter and CompanionOutput currently treat one lease as exactly one
waveform and release it at child close. Preserve the logical unit reservation
across sequential parts instead. A part may finish only after its physical child
closes. The next child uses the same captured concrete endpoint; even a System
default choice must not resolve to a different device halfway through the unit.
Recheck that exact endpoint before each physical start and fail closed if it
disappears.

Keep the native helper protocol unchanged: each helper still owns one WAV and
exits after retirement. Sequential helper processes are acceptable for the first
increment. Do not undertake streaming AudioQueue/WASAPI/PipeWire rewrites merely
to remove boundary gaps. Measure those gaps before proposing that separate
optimization.

Agree this seam before parallel implementation:

-   SpeechOutput gains an explicit parts capability. Its play and event contract
    includes a part ordinal, defaulting to zero on the unchanged legacy path.
    The existing id remains the whole-unit id, and status/observation report the
    whole unit.
-   AudioAdapter.play receives the lease, WAV and part ordinal. The lease owns
    the entire unit. Accept part zero, then exactly the next ordinal after the
    previous physical child has closed; reject duplicates, skipped parts and
    concurrent starts.
-   AudioEvent includes the immutable part ordinal as well as
    connection/job/page and sequence. NativeAdapter ignores callbacks from
    previous parts even when the unit id still matches.
-   CompanionOutput forwards part events but does not release the unit at each
    natural part end. SpeechService explicitly stops/releases after the final
    part or any cancellation/failure. Adapter stop is idempotent and waits for
    any current child.
-   SpeechService's public NarrationPort remains unchanged. Only the final
    natural part end produces a whole-unit natural end. Intermediate completion
    cannot satisfy the workspace narration gate or the integration observation
    oracle.

Pause stops playback immediately and prevents starting another part or new
lookahead. An already-running local inference may complete into the single
lookahead slot; it keeps its existing independent watchdog. Resume continues the
current part, then the next part, without regenerating or re-admitting a
different output. Cancel discards buffered parts and invalidates pending
inference; retain worker/process ownership until its existing retirement
conditions hold.

### Spec first, then TDD

Add a uniquely named SentencePipeline model with two units, three parts,
asynchronous synthesis, playback, pause, cancellation and late callbacks. Check
one admitted unit, one physical child, at most one lookahead, contiguous part
delivery, no start while paused, no stale playback, fixed route, aggregate
bounds, final-only completion and unchanged reading/approval gates. Separate
liveness assumptions for fair synthesis, physical close and eventual resume. A
paused unit is allowed to remain paused.

Extend the relevant LocalAudioOwnership/OutputAdmission mappings for a logical
lease spanning parts. Do not overwrite existing models, including either
PanelReplay model. Mutations must detect premature release, a stale part end
completing the new part, a third buffered part, dispatch while paused, route
re-resolution, whole-unit completion after part zero, and disabled
synthesis/play/retirement. Keep healthy liveness checks separate from
interrupted executions.

Regression priorities: exact text reconstruction;
abbreviations/decimals/quotes/Unicode and many short sentences; first sound
before second inference completes; both completion orderings; pause at the
boundary; reply during lookahead; delayed child close; device loss; page
replacement; one thinking tail; aggregate overflow; failure after partial
speech; no cloud request multiplication. Include actual NativeAdapter to
CompanionOutput to SpeechService composition, not only independent mocks.

### Exact parallel ownership

Terra A owns sentence planning and service scheduling: new
packages/vscode/src/speech_segments.ts; speech_service.ts, speech_synthesis.ts,
speech_waveform.ts, speech_worker_messages.ts and speech_worker_host.ts; their
unit/composed tests; SentencePipeline model and service model mappings. It owns
the SpeechOutput/SpeechAudioEvent seam declarations.

Terra B owns multi-part output leases: packages/audio-native/src/index.ts,
native_adapter.ts, admission.ts and playback.ts;
packages/audio-ui/src/companion_output.ts and its integration tests; output
ownership model refinements. Any necessary speech_host observation adjustment
belongs to B after agreement with A. No native Swift/C++ wire change is planned.
The legacy router/webview remains on the one-part capability.

Root coordinates the seam, issues, build leases, docs/Archi/version and complete
integration gates. Astra reviews the models before production code and then the
composed implementation. Root should assign any additional production
integration edit to Terra rather than make concurrent edits to either owner's
files.

### Acceptance and uncertainty

Use a small fixed two-voice, two-to-four-sentence Kokoro corpus. Compare
first-start latency and boundary gaps against the current whole-unit path under
the same VM load, separately cold and warm. Record distributions and raw
timings; do not advertise a host speedup from VM results. Single-sentence
behavior should remain unchanged. Run private Linux output lifecycle checks with
multiple parts and packaged local GUI narration. Windows/macOS output
compatibility is maintained through the unchanged helper protocol; the existing
Linux-only Kokoro runtime limitation remains.

The main uncertainty is whether inference throughput and repeated helper startup
leave noticeable gaps. The feature must not hide gaps with filler, drop text,
speed up automatically, or accumulate a queue. If gaps dominate, report them and
make the later continuous-stream improvement a measured decision.

## 2. Separate synthesis speed from pitch-preserving listening speed

Preserve existing provider-specific speed values and their meaning. Add a
provider-independent listening-speed preference, default 1.0, sampled once per
admitted unit. Keep code pace and reading speed separate. A settings change
affects the next narration or Preview, not audio already buffered. Do not
multiply speech speed by the code-pace control.

Use a shared local PCM time-stretch stage before WAV framing, on both providers.
Native playback continues receiving ordinary mono 24 kHz PCM16 WAV; this avoids
platform-specific rate/pitch differences and leaves pause/retirement semantics
unchanged. Apply DSP before adding the final fixed 600 ms thinking tail. Derive
all duration bounds and playback watchdogs from actual transformed samples. If a
requested rate exceeds the existing final duration/byte limit, fail visibly
rather than silently changing rate or truncating audio.

Initial target range is 0.75 to 1.5 at a small discrete set of rates. Keep 1.0
byte-exact, including cloud PCM. The upstream PR14 WSOLA implementation is
useful reference material, not a validated drop-in: inspect edge handling,
correlation bounds, silence and short inputs; verify the exact source/license
before any copy. Do not adopt its 1.3 Kokoro cap as a proven universal
intelligibility threshold. Existing provider synthesis speed controls remain
supported until measured evidence and an explicit product change justify
migration.

Before exposing controls, run a bounded DSP spike with independent tests:
duration within one window of the target, stable dominant frequency on voiced
tones, no non-finite/out-of-range samples, unchanged input,
silence/impulse/short-buffer edges, and cancellation of processing. Run DSP in a
local worker rather than block the UI extension event loop. Check a real
two-voice technical-speech corpus for clicks, missing consonants, repetition and
intelligibility; synthetic frequency tests cannot prove listening quality. If
the full range fails those checks, ship only validated rates or defer the
control, not an unqualified pitch-preserving claim.

Add SpeechTempo model/mappings for immutable rate snapshots, transform
ownership, post-transform bounds and stale/canceled transform rejection.
Mutations target applying current settings to old audio, compressing thinking
time, wrong duration/watchdog and canceled-result playback. Tests must prove no
extra cloud request when changing listening speed or preview processing.

Terra A owns DSP module/worker, PCM framing and numerical/audio fixtures. Terra
B owns speech settings/types, both host compositions, panel
messages/HTML/webview controls, persistence/migration tests and service
transform integration. Agree the PCM boundary first; only B edits
speech_service.ts in this increment. Root handles docs/Archi and acceptance
coordination; Astra reviews DSP and integration separately.

## 3. Common warm local-worker protocol

The current Kokoro worker already stays loaded between successful units. This
increment standardizes and isolates that lifecycle; it does not require another
model, Python/uv installation, cloud session or API key. Keep ElevenLabs as the
existing remote-provider client. Do not invent unused engine adapters merely to
demonstrate extensibility.

Extract the local worker lifecycle from SpeechService behind one used
local-synthesis client. Define strict, versioned init/ready, synthesize/result,
fixed-category failure and shutdown messages. Include worker epoch, unit id and
part ordinal. Ready carries bounded actual capabilities (voices, supported
synthesis rates, sample format and limits). The checked installed model root is
supplied by host construction, never by MCP/webview input. Return bounded
PCM/audio with exact ownership; reject malformed, oversized, duplicate and late
responses before buffering.

Keep the current Node worker transport for the shipped Kokoro engine. The
protocol can be transport-neutral without shipping an unused child-process
transport. A future engine that actually requires a separate process must bring
its own packaged, tested transport and parent-death guarantees in a later
change. Native audio helper protocol and synthesis protocol remain separate
because their responsibilities differ.

Maintain one load and one inference per worker, no overlapping replacement while
termination is pending, and reuse a healthy warm model. Cancellation invalidates
the result immediately; if inference cannot be interrupted safely, discard its
eventual result and keep the bounded retirement policy. Do not claim that
sending a cancel message stops a synchronous model call. Fatal load errors
retire the worker and produce a truthful unavailable state. Preview/explicit new
work may trigger the existing controlled retry behavior; there is no automatic
replay of canceled or failed text.

Add WarmSynthesisWorker model: cold/loading/ready/busy/retiring/dead, two
epochs, two units/parts, delayed readiness/result/exit and independent watchdog.
Check single engine/inference, ready only after validated init, stale rejection,
ownership retained through termination, bounded buffers and progress under fair
load/result/exit. Mutations disable epoch checks, allow overlapping replacement,
accept wrong-part output, or disable settlement.

Terra A owns new local synthesis client/schema/worker-host files and actual
Kokoro worker adapter plus tests. Terra B owns the SpeechService replacement of
inline worker logic, composed companion/legacy integration and packaging
manifest/build identity changes. Freeze the versioned seam first. Root
coordinates architecture docs and final offline extracted-VSIX/model-reuse
proof; Astra audits protocol and state transitions before source signoff.

## Cloud compatibility and primary references

First increment deliberately leaves the current single ElevenLabs request
unchanged. ElevenLabs documents a single-request streaming TTS endpoint; if
cloud first-audio latency is later prioritized, that is preferable to
speculative per-sentence paid requests. It still requires a separate bounded PCM
streaming/backpressure implementation and account-compatible output validation.
It is not part of this first increment and no live credit-consuming test is
assumed authorized.

-   ECMAScript Intl.Segmenter, including sentence granularity:
    https://tc39.es/ecma402/#segmenter-objects
-   ElevenLabs streaming TTS request, output formats and context fields:
    https://elevenlabs.io/docs/api-reference/text-to-speech/stream
-   Upstream architectural reference only:
    https://github.com/faiface/ai-pair/pull/14 and cached reviewed
    timeStretch/voiceQueue sources at /tmp/ai-pair-upstream-voice-review. Exact
    reuse provenance needs verification before copying; this plan does not
    certify the reference implementation's audio quality.

For every increment: preserve existing coverage floors, add solitary tests plus
meaningful composed/native checks, record model results and negative controls,
update DECISIONS and the Archi source/export in the same change, and distinguish
source approval from packaged GUI, platform/device and real-account evidence. No
deadline estimate is reliable until the first multi-part reservation prototype
establishes its boundary costs; this is staged feature work, not a small
preference-only patch.

## Sentence pipeline checkpoint, 2026-11-08

Astra approved the sentence scheduler and retained multipart lease, then
independently reviewed the narrow throwing-observer cleanup correction. The
full pre-correction unit run passed 1,801 tests with all measured source metrics
at 100 percent; the correction separately passed 19 focused/composed tests.
These results do not replace the still-failing legacy integration coverage gate.

A disposable installed 0.20.0 pair exercised a 23-word, three-sentence narration
through the public controller, real Kokoro runtime and private PipeWire null
sink. The selected unit started and ended naturally. Its fixture observed
first start at 3,472 ms and final completion at 14,531 ms on this VM. No
whole-waveform baseline or per-part timing was exposed, so this does not
establish a latency improvement or measure boundary gaps. The package preceded
the observer-exception correction; the final combined package requires another
verification run. No ElevenLabs request or host audio device was used.

The first harness run used an expired private PipeWire server. The server was
restarted with hardware monitors disabled; its graph contained only dummy
drivers and the test null sink, with zero devices. A second run still failed
before starting speech. A subsequent probe with a bounded initial delay passed;
initial discovery timing is a candidate explanation, not a confirmed cause.
The successful probe preserved all private environment guards and made one
narration attempt.
