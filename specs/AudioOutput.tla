---- MODULE AudioOutput --------------------------------------------------------
(***************************************************************************)
(* A single native output process, with asynchronous start and close.     *)
(* Output and page epochs invalidate stale callbacks. Retirement retains  *)
(* ownership until process close. Only a natural close reports ended.     *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardCurrent, GuardTarget, GuardRetire, GuardPaused, GuardNatural,
    GuardDefault

VARIABLES phase, generation, epoch, page, selected, requestEpoch,
          requestPage, target, actual, valid, owned, paused, outcome,
          reading, approval, canceledEnd, live, actualJob, badExit, defaultBusy
vars == <<phase, generation, epoch, page, selected, requestEpoch,
          requestPage, target, actual, valid, owned, paused, outcome,
          reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy>>

TypeOK ==
    /\ phase \in {"idle", "starting", "playing", "paused", "retiring"}
    /\ generation \in 0..2 /\ epoch \in 0..2 /\ page \in 0..2
    /\ selected \in {"a", "b"} /\ target \in {"a", "b"}
    /\ actual \in {"none", "a", "b"} /\ requestEpoch \in 0..2
    /\ requestPage \in 0..2 /\ valid \in BOOLEAN /\ owned \in BOOLEAN
    /\ paused \in BOOLEAN /\ outcome \in {"none", "ended", "canceled"}
    /\ reading \in BOOLEAN /\ approval \in BOOLEAN
    /\ canceledEnd \in BOOLEAN /\ live \in 0..1
    /\ actualJob \in 0..2 /\ badExit \in BOOLEAN
    /\ defaultBusy \in BOOLEAN

Init ==
    /\ phase = "idle" /\ generation = 0 /\ epoch = 0 /\ page = 0
    /\ selected = "a" /\ requestEpoch = 0 /\ requestPage = 0
    /\ target = "a" /\ actual = "none" /\ valid = FALSE /\ owned = FALSE
    /\ paused = FALSE /\ outcome = "none" /\ reading = TRUE
    /\ approval = TRUE /\ canceledEnd = FALSE
    /\ live = 0 /\ actualJob = 0 /\ badExit = FALSE /\ defaultBusy = FALSE

Reserve ==
    /\ phase = "idle" /\ ~owned /\ ~paused /\ ~defaultBusy
    /\ generation < 2
    /\ generation' = generation + 1 /\ requestEpoch' = epoch
    /\ requestPage' = page /\ target' = selected /\ valid' = TRUE
    /\ owned' = TRUE /\ phase' = "starting" /\ outcome' = "none"
    /\ actual' = "none" /\ live' = 1 /\ actualJob' = 0
    /\ UNCHANGED <<epoch, page, selected, paused, reading, approval,
                   canceledEnd, badExit, defaultBusy>>

Start(job) ==
    /\ job \in 1..2
    /\ phase = "starting" \/ (~GuardCurrent /\ phase = "retiring")
    /\ (~GuardCurrent \/ (valid /\ requestEpoch = epoch /\ requestPage = page /\
        job = generation))
    /\ (~GuardPaused \/ ~paused)
    /\ actual' \in IF GuardTarget THEN {target} ELSE {"a", "b"}
    /\ phase' = "playing" /\ actualJob' = job
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, badExit, defaultBusy>>

Pause ==
    /\ ~paused /\ paused' = TRUE
    /\ phase' = IF phase = "playing" THEN "paused" ELSE phase
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, outcome,
                   reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy>>

Resume ==
    /\ paused /\ paused' = FALSE
    /\ phase' = IF phase = "paused" THEN "playing" ELSE phase
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, outcome,
                   reading, approval, canceledEnd, live, actualJob,
          badExit, defaultBusy>>

Cancel ==
    /\ owned /\ phase # "retiring" /\ valid' = FALSE
    /\ phase' = IF GuardRetire THEN "retiring" ELSE "idle"
    /\ outcome' = "canceled"
    /\ owned' = IF GuardRetire THEN owned ELSE FALSE
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, paused, reading,
                   approval, canceledEnd, live, actualJob, badExit,
                   defaultBusy>>

Change ==
    /\ epoch < 2 /\ epoch' = epoch + 1 /\ selected' \in {"a", "b"}
    /\ valid' = FALSE /\ phase' = IF owned THEN "retiring" ELSE "idle"
    /\ UNCHANGED <<generation, page, requestEpoch, requestPage, target,
                   actual, owned, paused, outcome, reading, approval,
                   canceledEnd, live, actualJob, badExit, defaultBusy>>

Page ==
    /\ page < 2 /\ page' = page + 1 /\ valid' = FALSE
    /\ phase' = IF owned THEN "retiring" ELSE "idle"
    /\ UNCHANGED <<generation, epoch, selected, requestEpoch, requestPage,
                   target, actual, owned, paused, outcome, reading, approval,
                   canceledEnd, live, actualJob, badExit, defaultBusy>>

Exit(job) ==
    /\ job \in 1..2 /\ (~GuardCurrent \/ job = generation)
    /\ owned /\ phase \in {"playing", "retiring"}
    /\ outcome' = IF phase = "playing" \/ ~GuardNatural
                  THEN "ended" ELSE "canceled"
    /\ canceledEnd' =
        (canceledEnd \/ (phase = "retiring" /\ outcome' = "ended"))
    /\ phase' = "idle" /\ owned' = FALSE /\ valid' = FALSE
    /\ live' = 0 /\ badExit' = (badExit \/ job # generation)
    /\ actual' = "none"
    /\ UNCHANGED <<generation, epoch, page, selected, requestEpoch,
                   requestPage, target, paused, reading, approval, actualJob,
                   defaultBusy>>

DefaultStart ==
    /\ ~defaultBusy /\ (~GuardDefault \/ live = 0)
    /\ defaultBusy' = TRUE
    /\ UNCHANGED <<phase, generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, actualJob, badExit>>

DefaultEnd ==
    /\ defaultBusy /\ defaultBusy' = FALSE
    /\ UNCHANGED <<phase, generation, epoch, page, selected, requestEpoch,
                   requestPage, target, actual, valid, owned, paused, outcome,
                   reading, approval, canceledEnd, live, actualJob, badExit>>

Next == Reserve \/ (\E job \in 1..2: Start(job)) \/ Pause \/ Resume
        \/ Cancel \/ Change \/ Page \/ (\E job \in 1..2: Exit(job))
        \/ DefaultStart \/ DefaultEnd
Spec == Init /\ [][Next]_vars /\ WF_vars(\E job \in 1..2: Start(job)) /\
        WF_vars(\E job \in 1..2: Exit(job))
NoRevival == phase = "playing" =>
    (valid /\ requestEpoch = epoch /\ requestPage = page /\
     actualJob = generation)
NoFallback == phase \in {"playing", "paused"} => actual = target
NoOverlap == owned = (live = 1)
NoCrossRouteOverlap == ~(live = 1 /\ defaultBusy)
NoStartPaused == phase = "playing" => ~paused
NoCanceledEnd == ~canceledEnd /\ ~badExit
IndependentGates == reading /\ approval
RetirementCompletes == (phase = "retiring") ~> ~owned
StartProgress == (phase = "starting" /\ ~paused /\ valid) ~>
                 (phase # "starting" \/ paused \/ ~valid)
================================================================================
