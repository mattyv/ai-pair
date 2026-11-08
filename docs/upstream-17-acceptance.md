# Acceptance criteria for selected upstream PR 17 changes

These criteria were set before implementation on 2026-11-08. They govern
selective adoption, not acceptance of the whole upstream PR. The independent
reviewer must assess the final implementation and verification evidence.

## Scope and integration gate

Deliver prompt command results and clear working, ready and approval status.
Keep the existing queue depth and selected-speech policy. Complete independent
review and verification of the pending working-directory, runtime-identity and
session-recovery safety changes before integrating the feature. Parallel
implementation is allowed; successful feature tests do not waive that gate.

The safety evidence must cover invalid explicit directories without fallback,
valid in-workspace directories, omitted-directory discovery, matching packaged
runtime identities, missing and mismatched versions or hashes, and the actual
packaged SDK/MCP boundary. Verify the reproduced older-window launcher case.
Record the executable and editor build actually tested. New runtime checks do
not retroactively protect an already-running old relay.

## Command-result delivery

- A completed command wakes a waiting `listen` or applicable empty `step` on
  the next normal controller update, without waiting for the heartbeat.
- Deterministic tests keep the heartbeat pending and prove the result is
  delivered after command completion, including when another batch remains.
- Success, nonzero exit and command failure arrive once, without lost reports.
- Ordinary completed typing does not wake `listen`.
- Nonempty `step`, `end`, human-turn edit debounce and interruption settlement
  retain their contracts. Early results must not acknowledge an interruption
  before its playing batch has settled.
- The model distinguishes command news from quiet completion, consumes news
  atomically, and proves eventual delivery under fair report handling.
  Mutations must expose lost wakeups, duplicate delivery, quiet-news wakeups
  and premature `end` completion.

## Status

- Distinguish accepted work waiting to play, actual command approval, and an
  active agent outside a waiting call. No-call state is not proof of thinking.
- Ready count equals accepted, unplayed waiting batches and changes on start,
  completion, interruption, failure and disconnect. Rejected or discarded work
  never contributes.
- Approval status exists only while a decision is pending and clears on every
  terminal path, including cancellation and session end.
- Existing disconnected, absent, paused, reading, running and human-turn states
  remain intelligible. New indicators do not conceal these states.

## Optional beats deferred

The proposed optional beat pairs one short explanation with a related edit.
It would need actual action, reading and selected-speech completion gates,
independent speed controls, immediate Stop, and reading hold that prevents
further edits after the current atomic edit. Reading skip must not bypass
unfinished speech or edits. Deferred replies must retain their action boundary.
All of these requirements apply to typing, line and block modes, speech failure,
interruption and recovery. Default playback must remain explanation first.

Source inspection found that the current player waits for reading and selected
speech before returning from `say`. Typing delays and grouped-code pauses use
the same `Timeline`, which tracks only one sleeper. Starting another sleep
replaces that tracked sleeper. An already-armed old timer can still resolve,
but pause, hold, finish and interrupt control only the latest sleeper. A
replaced held or paused sleeper can remain unresolved. Concurrent reading and
typing would therefore lose control ownership, not merely need a timing tweak.
The player's `afterAction` callback also defines deferred-reply delivery;
combining actions into a synthetic beat would change that boundary.

The reviewer accepts deferral because independent clocks, completion gates,
cancellation and their models are a broader architectural change. This release
must not claim that beats were implemented. Automated verification cannot
establish human comfort; a later optional prototype requires a user trial.

## Deeper work-ahead deferred

Current playback already overlaps preparation of the next batch. Increasing
queue depth requires representative traces showing idle gaps that a deeper
buffer would remove, followed by separate stale-state and interruption
verification. It is not an automatic part of this change.

## Verification and provenance

Before borrowing implementation, record the isolated upstream commit and stack
trial, license and provenance, conflicts, and concrete reasons for adaptation.
Keep compatible upstream code where possible. Use spec-first development and
meaningful failing tests, resolve independent review findings, and preserve all
existing coverage floors. Run local checks before the minimum final required
CI. Update applicable documentation, version and changelog. Architecture changes
require the Archi source model and generated exports verified together.

Final approval requires evidence for the applicable criteria, completed safety
integration, green required checks and resolved independent review. Deferring
beats and deeper queuing is an explicit scope decision, not proof of their
implementation or usability.
