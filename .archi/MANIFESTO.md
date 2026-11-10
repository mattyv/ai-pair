# Architecture principles

These principles govern changes to AI Pair and guide its Archi diagrams. Read
them before designing or reviewing a change. Apply them to the affected
boundary, without using them as permission for an unrelated rewrite.

## Authority and scope

This is the canonical repository manifesto. [Agent instructions](/AGENTS.md)
and [working rules](/CLAUDE.md) define the development process.
[Decisions](/DECISIONS.md) record concrete choices and limits.
[Architecture](/ARCHITECTURE.md) describes the implementation. Keep each fact
at its authoritative source. Link to that source instead of maintaining
parallel rules or architecture copies.

This document adapts Archi-Techture 1.5.1's shipped
`EXAMPLE_ARCHI_MANIFESTO.md`, rather than a personal manifesto, to this
repository's recorded decisions and lifecycle lessons. These obligations are
review requirements. Existing modules and tooling do not necessarily satisfy
or enforce every requirement.

## One owner for each state and resource

A single component owns each mutable fact and its transitions. Callers send
intent to that owner and consume its snapshots. This prevents different parts
of the system from disagreeing about whether work is active or finished.

-   Define lifecycle states, permitted transitions and resource invariants
    before adding behavior. Use discriminated states where they prevent
    impossible combinations. Do not add parallel busy, ready or disposed flags
    in hosts to reconstruct an existing owner's state.
-   Distinguish desired settings, observed health, logical admission and
    physical ownership. One cannot stand in for another. Derive UI status from
    authoritative snapshots, with no independent UI lifecycle.
-   Name the owner of every process, worker, timer, listener, transport and
    output reservation. An ownership transfer needs an explicit acceptance
    point and a defined failure path.

Verify transitions with solitary owner tests and composed traces through its
callers. A diagram must identify the owner, not merely show connected boxes.

## Cancellation does not mean retirement

An abort requests a stop. It does not prove that a process exited, a worker
terminated or an output stopped. Releasing a physical slot too early permits
overlap even when the logical state machine appears idle.

-   Invalidate canceled work immediately. Retain its physical lease until the
    matching close, termination or disposal evidence arrives. Do not mark an
    owner disposed while it still owns live resources.
-   Serialize replacement behind retirement. A queued successor should proceed
    when retirement completes without requiring a second user request.
-   Make cleanup repeatable. Deadlines bound waiting and report failure. They
    must not manufacture successful cleanup. If a resource cannot be reaped,
    keep its ownership recorded. Block unsafe reuse until retirement
    completes.
-   Normal shutdown awaits owned resources. State explicitly where abrupt
    process or operating-system termination falls outside that guarantee.

Test cancellation during startup, active work and retirement, including late
completion and failure to stop. Use real child-process tests where a fake
close event cannot establish the required operating-system behavior.

## Make asynchronous identity explicit

Single-threaded JavaScript still interleaves at awaits and callbacks. Every
asynchronous owner must document what can interleave and what remains true at
each yield point.

-   Scope requests and callbacks to the connection, session, page or resource
    generation they belong to. A locally unique request number is insufficient
    when a replacement owner can reuse it.
-   Check identity before accepting completion or starting effects. A stale
    callback may retire its own resource. It must not publish successor
    health, release a successor's lease or restart canceled work.
-   Give supersession, timeout, reentrancy and disposal explicit transitions.
    Register ownership before invoking effects that can call back immediately.
    Treat observer callbacks as foreign code. Their failure must not prevent
    essential cleanup or progress.

Test these interleavings:

- A late result from a predecessor after a successor starts.
- Reused local IDs across sessions.
- Synchronous callbacks as well as deferred callbacks.

## Readiness requires current evidence

Configuration expresses intent. Installed assets establish setup. A worker's
ready acknowledgement establishes a live worker. None proves audible output.
Keep these facts separate so the user can act on an honest status.

-   Restore preferences after restart, never live handles, proof capabilities
    or stale readiness. Scope health to the generation that established it.
    Unknown stays unchecked. A transient busy refusal does not overwrite
    verified health.
-   Prepare enabled local speech when its owning host loads or changes those
    settings. Disabled speech and cloud selection must not start local
    workers. Warmup must not synthesize, play audio or download models
    implicitly.
-   Gate first use on the actual readiness and attachment acknowledgements it
    requires. Preserve ordering between activation, preparation, ownership
    commitment and session creation. A dispatched command is not acceptance.
-   Derive status from current evidence. Describe its limits. Separate
    setup checks, admitted workers, route availability and physical
    audibility.

Verify cold start, restart, mode changes and disabled startup. Test status
before the first session as well as after successful work.

## Keep boundaries strict and failures scoped

The core owns editor-independent policy. Hosts adapt VS Code, browser, device,
network and process APIs through explicit ports. Keep hosts thin so ownership
and policy can be exercised without running the editor.

-   Parse untrusted boundary input with shared protocol schemas. Derive types
    from those schemas. Validate each actual trust boundary. Do not scatter
    competing parsers through trusted internal code. Give protocol evolution
    an explicit compatibility policy. Test rejection paths.
-   Keep credentials and audio in their owning local host. Send only the
    allowlisted data a boundary requires. Diagnostics use bounded, sanitized
    facts rather than raw payloads or exception text.
-   Bound external operations and payloads. Define timeout and retry behavior.
    Retry only when the owner prevents duplicate effects or those effects are
    harmless. Preserve operation identity across boundaries that require
    correlation.
-   Fail closed when identity, compatibility or exclusive ownership is unsafe.
    Scope failure to the affected capability: optional audio failure must not
    crash the editor. Do not substitute another owner, provider, workspace or
    output silently. Safe degradation must be an explicit product decision.

Verify malformed frames, unavailable dependencies, timeout and incompatible
versions. Test that optional-capability failure leaves unrelated functions
usable and never creates a second owner.

## Design effects for deterministic tests

Inject clocks and external effects at ownership boundaries. A test should
control when an effect settles, rather than guess with a sleep. A resource or
trust boundary justifies an interface on its first use. Three callers are not
a prerequisite for correct ownership.

-   Follow the repository's solitary unit-test rules: one source file, mocked
    collaborators, shared schemas checking mock contracts. Test public
    behavior and invariants without reaching into private fields.
-   Also test composed lifecycles with real collaborating modules and
    controlled external effects. Solitary tests cannot establish attachment,
    host wiring or retirement ordering between owners.
-   Keep process, packaged-host, hardware and human-listening checks distinct.
    Report exactly which evidence exists. Coverage measures exercised code. It
    does not establish safe ordering, hardware support or audible quality.

For behavioral changes, write a meaningful failing test before implementation.
Follow the spec-first process in [working rules](/CLAUDE.md). Include adverse
interleavings, not just the successful sequence.

## Models prove only what they model

Use TLA+ to examine ownership, ordering and progress before implementing their
changes. Map modeled actions and invariants to code and named tests. Include
physical retirement when the safety claim depends on it. An abstract abort
must not stand in for actual reaping.

Record the model evidence:

-   Configurations and finite bounds.
-   Fairness assumptions.
-   Checked safety and liveness properties.
-   Mutation counterexamples that show the properties detect incorrect
    behavior.

A passing bounded model is evidence about that model, not a proof of all
implementation behavior. Validate counterexamples against code. Test the
integration and environmental assumptions the model omits.

## Prefer existing mechanisms and small, complete changes

Use an existing owner, schema, clock, transport or platform facility before
adding another. Share genuinely common behavior. Do not create a framework for
hypothetical future providers or merge merely similar policies.

-   Give a module a small interface that hides its owned complexity. Avoid
    wrappers that expose every internal detail and require callers to manage
    its state anyway.
-   Inspect and trial upstream work in an isolated worktree before adapting
    it. Preserve compatible code and history. Record concrete incompatibility
    or verified defects before expanding a rewrite.
-   Record material choices and limitations in [Decisions](/DECISIONS.md).
    Keep detailed investigation in issue working notes and issues.
-   When boundaries or ownership change, update the Archi source and generated
    exports together. Verify both artifacts. A new principle alone does not
    imply a changed runtime architecture.
-   Diagram the implemented architecture. Label proposals separately. Never
    draw compliance that the source does not have.

## Review and enforcement

For each affected boundary, the reviewer checks:

- The owner and state transitions.
- Physical retirement evidence.
- Asynchronous identity.
- Readiness gates and failure scope.
- Solitary and composed tests.

Record omissions and
exceptions in the decision record. Include their rationale, scope and a
condition for revisiting them. Do not weaken an existing quality bar without
the user's authorization.

Existing lint, type checks, coverage gates, protocol tests and TLC runs
enforce parts of this document. Ownership, dependency direction, evidence
quality and failure scope still require review. The repository has no general
manifesto or import-boundary checker. Run the applicable repository checks.
Report remaining validation gaps before calling a change complete.
