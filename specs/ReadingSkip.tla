---- MODULE ReadingSkip --------------------------------------------------------
(******************************************************************************)
(* Finishing an individual say's reading countdown, without resuming a pause. *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxId
ASSUME Bounded == MaxId \in Nat \ {0}

VARIABLES nextId, reading, paused, agentTurn, suspended, held,
          lastAccepted, clicked,
          clickId, beforeId, beforePaused, beforeAgentTurn, beforeSuspended,
          beforeHeld
vars == <<nextId, reading, paused, agentTurn, suspended, held,
          lastAccepted, clicked,
          clickId, beforeId, beforePaused, beforeAgentTurn, beforeSuspended,
          beforeHeld>>

TypeOK ==
    /\ nextId \in 1..(MaxId + 1)
    /\ reading \in 0..MaxId
    /\ paused \in BOOLEAN
    /\ agentTurn \in BOOLEAN
    /\ suspended \in BOOLEAN
    /\ held \in BOOLEAN
    /\ lastAccepted \in BOOLEAN
    /\ clicked \in BOOLEAN
    /\ clickId \in 0..MaxId
    /\ beforeId \in 0..MaxId
    /\ beforePaused \in BOOLEAN
    /\ beforeAgentTurn \in BOOLEAN
    /\ beforeSuspended \in BOOLEAN
    /\ beforeHeld \in BOOLEAN

Init ==
    /\ nextId = 1
    /\ reading = 0
    /\ paused = FALSE
    /\ agentTurn = TRUE
    /\ suspended = FALSE
    /\ held = FALSE
    /\ lastAccepted = FALSE
    /\ clicked = FALSE
    /\ clickId = 0
    /\ beforeId = 0
    /\ beforePaused = FALSE
    /\ beforeAgentTurn = TRUE
    /\ beforeSuspended = FALSE
    /\ beforeHeld = FALSE

Start ==
    /\ reading = 0 /\ nextId <= MaxId
    /\ held' = FALSE
    /\ reading' = nextId
    /\ nextId' = nextId + 1
    /\ lastAccepted' = FALSE
    /\ clicked' = FALSE
    /\ UNCHANGED <<paused, agentTurn, suspended, clickId, beforeId,
                   beforePaused, beforeAgentTurn, beforeSuspended, beforeHeld>>

ChangeContext ==
    /\ paused' \in BOOLEAN
    /\ agentTurn' \in BOOLEAN
    /\ suspended' \in BOOLEAN
    /\ held' \in BOOLEAN
    /\ lastAccepted' = FALSE
    /\ clicked' = FALSE
    /\ UNCHANGED <<nextId, reading, clickId, beforeId, beforePaused,
                   beforeAgentTurn, beforeSuspended, beforeHeld>>

Finish ==
    /\ reading # 0
    /\ reading' = 0
    /\ held' = FALSE
    /\ lastAccepted' = FALSE
    /\ clicked' = FALSE
    /\ UNCHANGED <<nextId, paused, agentTurn, suspended, clickId, beforeId,
                   beforePaused, beforeAgentTurn, beforeSuspended, beforeHeld>>

Click(id) ==
    /\ id \in 1..MaxId
    /\ beforeId' = reading
    /\ beforePaused' = paused
    /\ beforeAgentTurn' = agentTurn
    /\ beforeSuspended' = suspended
    /\ beforeHeld' = held
    /\ clicked' = TRUE
    /\ clickId' = id
    /\ lastAccepted' = (reading = id /\ ~paused /\ agentTurn /\
                         ~suspended /\ ~held)
    /\ reading' = IF lastAccepted' THEN 0 ELSE reading
    /\ UNCHANGED <<nextId, paused, agentTurn, suspended, held>>

Next == Start \/ ChangeContext \/ Finish \/ \E id \in 1..MaxId : Click(id)
Spec == Init /\ [][Next]_vars

OnlyCurrent == lastAccepted =>
    (clickId = beforeId /\ beforeId # 0 /\ ~beforePaused /\
     beforeAgentTurn /\ ~beforeSuspended /\ ~beforeHeld /\ reading = 0)
EligibleFinishes == (clicked /\ clickId = beforeId /\ beforeId # 0 /\
                     ~beforePaused /\ beforeAgentTurn /\
                     ~beforeSuspended /\ ~beforeHeld)
                    => (lastAccepted /\ reading = 0)
IneligibleKeepsReading ==
    (clicked /\ (clickId # beforeId \/ beforeId = 0 \/ beforePaused \/
                  ~beforeAgentTurn \/ beforeSuspended \/ beforeHeld)) =>
        (~lastAccepted /\ reading = beforeId)
================================================================================
