---- MODULE ReadingHold --------------------------------------------------------
(******************************************************************************)
(* A hold is bound to one reading ID and never removes an ordinary pause.     *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxId
ASSUME Bounded == MaxId \in Nat \ {0}

VARIABLES reading, heldId, paused, beforeReading, beforeHeld, beforePaused,
          requestId, requestKind, accepted, ticks
vars == <<reading, heldId, paused, beforeReading, beforeHeld, beforePaused,
          requestId, requestKind, accepted, ticks>>

TypeOK ==
    /\ reading \in 0..MaxId
    /\ heldId \in 0..MaxId
    /\ paused \in BOOLEAN
    /\ beforeReading \in 0..MaxId
    /\ beforeHeld \in 0..MaxId
    /\ beforePaused \in BOOLEAN
    /\ requestId \in 0..MaxId
    /\ requestKind \in {"none", "hold", "release"}
    /\ accepted \in BOOLEAN
    /\ ticks \in Nat

Init ==
    /\ reading = 0 /\ heldId = 0 /\ paused = FALSE
    /\ beforeReading = 0 /\ beforeHeld = 0 /\ beforePaused = FALSE
    /\ requestId = 0 /\ requestKind = "none" /\ accepted = FALSE
    /\ ticks = 0

Start(id) ==
    /\ reading = 0 /\ id \in 1..MaxId
    /\ reading' = id /\ heldId' = 0 /\ requestKind' = "none"
    /\ UNCHANGED <<paused, beforeReading, beforeHeld, beforePaused, requestId,
                   accepted, ticks>>

ChangePause ==
    /\ paused' \in BOOLEAN /\ requestKind' = "none"
    /\ UNCHANGED <<reading, heldId, beforeReading, beforeHeld, beforePaused,
                   requestId, accepted, ticks>>

Request(id, kind) ==
    /\ id \in 1..MaxId /\ kind \in {"hold", "release"}
    /\ beforeReading' = reading /\ beforeHeld' = heldId
    /\ beforePaused' = paused /\ requestId' = id /\ requestKind' = kind
    /\ accepted' = IF kind = "hold"
                   THEN id = reading /\ ~paused /\ heldId = 0
                   ELSE id = reading /\ heldId = id
    /\ heldId' = IF accepted' THEN IF kind = "hold" THEN id ELSE 0
                  ELSE heldId
    /\ UNCHANGED <<reading, paused, ticks>>

Stop ==
    /\ reading # 0 /\ reading' = 0 /\ heldId' = 0
    /\ requestKind' = "none"
    /\ UNCHANGED <<paused, beforeReading, beforeHeld, beforePaused, requestId,
                   accepted, ticks>>

Tick ==
    /\ reading # 0 /\ heldId = 0 /\ ~paused
    /\ ticks' = ticks + 1 /\ requestKind' = "none"
    /\ UNCHANGED <<reading, heldId, paused, beforeReading, beforeHeld,
                   beforePaused, requestId, accepted>>

Next == (\E id \in 1..MaxId : Start(id)) \/ ChangePause \/ Stop \/ Tick \/
        (\E id \in 1..MaxId, kind \in {"hold", "release"} : Request(id, kind))
Spec == Init /\ [][Next]_vars

ScopedHold == heldId = 0 \/ heldId = reading
StaleDoesNothing == (requestKind # "none" /\ requestId # beforeReading) =>
    (~accepted /\ heldId = beforeHeld)
ReleaseKeepsPause == (requestKind = "release") => paused = beforePaused
EligibleHold == (requestKind = "hold" /\ requestId = beforeReading /\
                 ~beforePaused /\ beforeHeld = 0) =>
    (accepted /\ heldId = requestId)
EligibleRelease == (requestKind = "release" /\ requestId = beforeReading /\
                    beforeHeld = requestId) => (accepted /\ heldId = 0)
Constraint == ticks <= 1
================================================================================
