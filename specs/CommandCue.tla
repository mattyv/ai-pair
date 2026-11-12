---- MODULE CommandCue ---------------------------------------------------------
(******************************************************************************)
(* The command cue is optional and sounds once for a live confirmation.      *)
(* Replayed confirmations and all other run phases are silent.                *)
(******************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxId

ASSUME AssumeBound == MaxId \in Nat /\ MaxId > 0

VARIABLES enabled, seen, queued, queuedId, lastKind, lastEnabled, lastSeen,
          lastCue

vars == <<enabled, seen, queued, queuedId, lastKind, lastEnabled, lastSeen,
          lastCue>>

Kinds == {"live", "replay", "other"}

TypeOK ==
    /\ enabled \in BOOLEAN /\ seen \subseteq 1..MaxId
    /\ queued \in Kinds \cup {"none"} /\ queuedId \in 0..MaxId
    /\ lastKind \in Kinds \cup {"none"}
    /\ lastEnabled \in BOOLEAN /\ lastSeen \in BOOLEAN /\ lastCue \in BOOLEAN

Init ==
    /\ enabled = FALSE /\ seen = {} /\ queued = "none" /\ queuedId = 0
    /\ lastKind = "none" /\ lastEnabled = FALSE /\ lastSeen = FALSE
    /\ lastCue = FALSE

\* The setting is sampled when a live event is handled.
SetEnabled(value) ==
    /\ value \in BOOLEAN /\ enabled' = value
    /\ UNCHANGED <<seen, queued, queuedId, lastKind, lastEnabled, lastSeen,
                   lastCue>>

Queue(kind, id) ==
    /\ queued = "none" /\ kind \in Kinds /\ id \in 1..MaxId
    /\ queued' = kind /\ queuedId' = id
    /\ UNCHANGED <<enabled, seen, lastKind, lastEnabled, lastSeen, lastCue>>

\* A replay marks the ID seen without playing a cue.
Handle ==
    /\ queued # "none"
    /\ lastKind' = queued /\ lastEnabled' = enabled
    /\ lastSeen' = (queuedId \in seen)
    /\ lastCue' = (queued = "live" /\ enabled /\ queuedId \notin seen)
    /\ seen' = IF queued \in {"live", "replay"}
                THEN seen \cup {queuedId} ELSE seen
    /\ queued' = "none" /\ queuedId' = 0
    /\ UNCHANGED enabled

\* A fresh session may reuse its own IDs; old session state is discarded.
Fresh ==
    /\ queued = "none" /\ seen' = {} /\ lastKind' = "none"
    /\ lastEnabled' = FALSE /\ lastSeen' = FALSE /\ lastCue' = FALSE
    /\ UNCHANGED <<enabled, queued, queuedId>>

AnySetting == \E value \in BOOLEAN : SetEnabled(value)
AnyQueue == \E kind \in Kinds, id \in 1..MaxId : Queue(kind, id)
Next == AnySetting \/ AnyQueue \/ Handle \/ Fresh
Spec == Init /\ [][Next]_vars /\ WF_vars(Handle)

\* Cue decisions match the live event, setting and prior ID evidence.
CueCorrect ==
    lastCue <=> (lastKind = "live" /\ lastEnabled /\ ~lastSeen)

\* An event already queued is eventually handled.
EventProgress == [](queued # "none" => <> (queued = "none"))

================================================================================
