---- MODULE MultipartAudioLease ------------------------------------------------
(***************************************************************************
 * One unit lease spans multiple children and one immutable output route.  *
 * A terminal callback is distinct from proof that the child has closed.  *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardRetain, GuardClose, GuardIdentity, GuardRoute, GuardFinal,
    GuardPause, GuardOrder, GuardRecheck, GuardStarted

VARIABLES job, total, completed, part, phase, lease, live, paused, canceled,
          route, currentDefault, actual, available, terminal, delivered,
          finished, badStale, badEarly, badFinal, badPaused, badOrder,
          pauseEpoch, checkedEpoch, badCheck, startedSeen, terminalSuccess
vars == <<job, total, completed, part, phase, lease, live, paused, canceled,
          route, currentDefault, actual, available, terminal, delivered,
          finished, badStale, badEarly, badFinal, badPaused, badOrder,
          pauseEpoch, checkedEpoch, badCheck, startedSeen, terminalSuccess>>

Init ==
    /\ job = 0 /\ total = 3 /\ completed = 0 /\ part = 0
    /\ phase = "idle" /\ lease = FALSE /\ live = FALSE /\ paused = FALSE
    /\ canceled = FALSE /\ route = "a" /\ currentDefault = "a"
    /\ actual = "none" /\ available = TRUE /\ terminal = FALSE
    /\ delivered = 0 /\ finished = FALSE /\ badStale = FALSE
    /\ badEarly = FALSE /\ badFinal = FALSE
    /\ badPaused = FALSE /\ badOrder = FALSE
    /\ pauseEpoch = 0 /\ checkedEpoch = 0 /\ badCheck = FALSE
    /\ startedSeen = FALSE /\ terminalSuccess = FALSE

Begin ==
    /\ phase = "idle" /\ ~lease /\ ~live /\ job < 2
    /\ job' = job + 1 /\ total' \in 2..3 /\ completed' = 0
    /\ part' = 0 /\ phase' = "between" /\ lease' = TRUE
    /\ route' = currentDefault /\ canceled' = FALSE /\ finished' = FALSE
    /\ terminal' = FALSE /\ actual' = "none" /\ delivered' = 0
    /\ UNCHANGED <<live, paused, currentDefault, available, badStale,
                   badEarly, badFinal,
                   badPaused, badOrder, pauseEpoch, checkedEpoch, badCheck,
                   startedSeen, terminalSuccess>>

RequestNext ==
    /\ phase = "between" /\ lease /\ ~canceled /\ completed < total
    /\ phase' = "checking" /\ terminal' = FALSE
    /\ checkedEpoch' = pauseEpoch
    /\ part' \in IF GuardOrder THEN {completed} ELSE 0..2
    /\ badOrder' = (badOrder \/ part' # completed)
    /\ UNCHANGED <<job, total, completed, lease, live, paused, canceled, route,
                   currentDefault, actual, available, delivered, finished,
                   badStale, badEarly, badFinal, badPaused, pauseEpoch,
                   badCheck, startedSeen, terminalSuccess>>

Spawn ==
    /\ phase = "checking" /\ lease /\ ~live /\ ~canceled /\ available
    /\ (GuardPause => ~paused)
    /\ (GuardRecheck => checkedEpoch = pauseEpoch)
    /\ badPaused' = (badPaused \/ paused)
    /\ badCheck' = (badCheck \/ checkedEpoch # pauseEpoch)
    /\ phase' = "playing" /\ live' = TRUE
    /\ startedSeen' = FALSE /\ terminalSuccess' = FALSE
    /\ actual' = IF GuardRoute THEN route ELSE currentDefault
    /\ UNCHANGED <<job, total, completed, part, lease, paused, canceled, route,
                   currentDefault, available, terminal, delivered, finished,
                   badStale, badEarly, badFinal, badOrder, pauseEpoch,
                   checkedEpoch>>

Started(j, p) ==
    /\ j \in 1..2 /\ p \in 0..2 /\ phase = "playing" /\ live
    /\ ~startedSeen /\ ~terminal /\ (~GuardIdentity \/ (j = job /\ p = part))
    /\ badStale' = (badStale \/ j # job \/ p # part) /\ startedSeen' = TRUE
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, paused,
                   canceled, route, currentDefault, actual, available, terminal,
                   delivered, finished, badEarly, badFinal, badPaused, badOrder,
                   pauseEpoch, checkedEpoch, badCheck, terminalSuccess>>

Terminal(j, p) ==
    /\ j \in 1..2 /\ p \in 0..2 /\ phase = "playing" /\ live
    /\ (~GuardIdentity \/ (j = job /\ p = part))
    /\ badStale' = (badStale \/ j # job \/ p # part)
    /\ terminal' = TRUE
    /\ terminalSuccess' = (startedSeen \/ ~GuardStarted)
    /\ delivered' = IF GuardClose THEN delivered ELSE delivered + 1
    /\ phase' = IF GuardClose THEN "closing" ELSE "between"
    /\ badEarly' = (badEarly \/ ~GuardClose)
    /\ UNCHANGED <<job, total, completed, part, lease, live, paused, canceled,
                   route, currentDefault, actual, available,
                   finished, badFinal, badPaused, badOrder, pauseEpoch,
                   checkedEpoch, badCheck, startedSeen>>

ChildClosed(j, p) ==
    /\ j \in 1..2 /\ p \in 0..2 /\ live
    /\ phase \in {"closing", "retiring"}
    /\ (~GuardIdentity \/ (j = job /\ p = part))
    /\ badStale' = (badStale \/ j # job \/ p # part)
    /\ live' = FALSE /\ actual' = "none"
    /\ completed' = IF canceled \/ ~terminalSuccess
        THEN completed ELSE completed + 1
    /\ delivered' = IF canceled \/ ~terminalSuccess
        THEN delivered ELSE delivered + 1
    /\ lease' = IF canceled THEN FALSE ELSE GuardRetain
    /\ phase' = IF canceled THEN "idle" ELSE
              IF terminalSuccess THEN "between" ELSE "failed"
    /\ UNCHANGED <<job, total, part, paused, canceled, route, currentDefault,
                   available, terminal, finished, badEarly, badFinal,
                   badPaused, badOrder, pauseEpoch, checkedEpoch, badCheck,
                   startedSeen, terminalSuccess>>

Release ==
    /\ phase = "between" /\ lease /\ (completed = total \/ ~GuardFinal)
    /\ badFinal' = (badFinal \/ completed # total)
    /\ finished' = TRUE /\ lease' = FALSE /\ phase' = "idle"
    /\ UNCHANGED <<job, total, completed, part, live, paused, canceled, route,
                   currentDefault, actual, available, terminal, delivered,
                   badStale, badEarly, badPaused, badOrder, pauseEpoch,
                   checkedEpoch, badCheck, startedSeen, terminalSuccess>>

Cancel ==
    /\ lease /\ ~canceled /\ canceled' = TRUE
    /\ phase' = IF live THEN "retiring" ELSE "idle"
    /\ lease' = live
    /\ UNCHANGED <<job, total, completed, part, live, paused, route,
                   currentDefault, actual, available, terminal, delivered,
                   finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, pauseEpoch, checkedEpoch, badCheck,
                   startedSeen, terminalSuccess>>

Pause ==
    /\ ~paused /\ pauseEpoch < 2 /\ paused' = TRUE
    /\ pauseEpoch' = pauseEpoch + 1
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, canceled,
                   route, currentDefault, actual, available, terminal,
                   delivered, finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, checkedEpoch, badCheck, startedSeen,
                   terminalSuccess>>
Resume ==
    /\ paused /\ paused' = FALSE
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, canceled,
                   route, currentDefault, actual, available, terminal,
                   delivered, finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, checkedEpoch, badCheck, pauseEpoch,
                   startedSeen, terminalSuccess>>
ChangeDefault ==
    /\ currentDefault' \in {"a", "b"}
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, paused,
                   canceled, route, actual, available, terminal, delivered,
                   finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, checkedEpoch, badCheck, pauseEpoch,
                   startedSeen, terminalSuccess>>
LoseDevice ==
    /\ available /\ available' = FALSE
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, paused,
                   canceled, route, currentDefault, actual, terminal,
                   delivered, finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, checkedEpoch, badCheck, pauseEpoch,
                   startedSeen, terminalSuccess>>

Recheck ==
    /\ phase = "checking" /\ checkedEpoch # pauseEpoch
    /\ checkedEpoch' = pauseEpoch
    /\ UNCHANGED <<job, total, completed, part, phase, lease, live, paused,
                   canceled, route, currentDefault, actual, available, terminal,
                   delivered, finished, badStale, badEarly, badFinal,
                   badPaused, badOrder, pauseEpoch, badCheck, startedSeen,
                   terminalSuccess>>

Next == Begin \/ RequestNext \/ Spawn \/
        (\E j \in 1..2, p \in 0..2:
            Started(j, p) \/ Terminal(j, p) \/ ChildClosed(j, p)) \/
        Release \/ Cancel \/ Pause \/ Resume \/ Recheck
        \/ ChangeDefault \/ LoseDevice
Spec == Init /\ [][Next]_vars /\
        WF_vars(\E j \in 1..2, p \in 0..2: ChildClosed(j, p))
TypeOK ==
    /\ job \in 0..2 /\ total \in 2..3 /\ completed \in 0..3 /\ part \in 0..2
    /\ phase \in {"idle", "between", "checking", "playing",
                  "closing", "retiring", "failed"}
    /\ lease \in BOOLEAN /\ live \in BOOLEAN /\ paused \in BOOLEAN
    /\ canceled \in BOOLEAN /\ route \in {"a", "b"}
    /\ currentDefault \in {"a", "b"} /\ actual \in {"none", "a", "b"}
    /\ available \in BOOLEAN /\ terminal \in BOOLEAN /\ delivered \in 0..3
    /\ finished \in BOOLEAN /\ badStale \in BOOLEAN /\ badEarly \in BOOLEAN
    /\ badFinal \in BOOLEAN /\ badPaused \in BOOLEAN /\ badOrder \in BOOLEAN
    /\ pauseEpoch \in 0..2 /\ checkedEpoch \in 0..2 /\ badCheck \in BOOLEAN
    /\ startedSeen \in BOOLEAN /\ terminalSuccess \in BOOLEAN
LeaseRetained ==
    (phase \in {"between", "checking", "playing", "closing", "failed"}) => lease
NoStaleCallback == ~badStale
NoEarlyPartEvent == delivered <= completed
FixedRoute == live => actual = route
NoEarlyCompletion == finished => (completed = total /\ ~live /\ ~lease)
NoStartPaused == ~badPaused
NoSkippedPart == ~badOrder
NoStaleCheck == ~badCheck
NoUnstartedSuccess == terminalSuccess => startedSeen
ContiguousParts == delivered = completed
NoOverlap == (phase = "checking") => ~live
CanRequest == (phase = "between" /\ lease /\ ~canceled /\ completed < total)
              => ENABLED RequestNext
CanSpawn == (phase = "checking" /\ lease /\ ~live /\ ~paused /\
             ~canceled /\ available /\ checkedEpoch = pauseEpoch)
            => ENABLED Spawn
CanClose == (phase \in {"closing", "retiring"} /\ live) =>
            ENABLED ChildClosed(job, part)
RetirementCompletes == (phase = "retiring") ~> ~live
CanFinish == (phase = "between" /\ lease /\ completed = total)
             => ENABLED Release
HealthyTerminal(j, p) == startedSeen /\ Terminal(j, p)
HealthyNext == Begin \/ RequestNext \/ Spawn \/
    (\E j \in 1..2, p \in 0..2:
        Started(j, p) \/ HealthyTerminal(j, p) \/ ChildClosed(j, p)) \/ Release
HealthySpec == Init /\ [][HealthyNext]_vars /\ WF_vars(Begin) /\
    WF_vars(RequestNext) /\ WF_vars(Spawn) /\
    WF_vars(\E j \in 1..2, p \in 0..2: Started(j, p)) /\
    WF_vars(\E j \in 1..2, p \in 0..2: HealthyTerminal(j, p)) /\
    WF_vars(\E j \in 1..2, p \in 0..2: ChildClosed(j, p)) /\ WF_vars(Release)
HealthyFinishes == <>(job = 2 /\ finished)
================================================================================
