---- MODULE TerminalPanel ------------------------------------------------------
(******************************************************************************)
(* The settings and reveal request keep each terminal tied to its command.    *)
(******************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Ids
ASSUME Ids = {1, 2}

VARIABLES auto, terminals, requested, shown, unavailable, started, startAuto
vars == <<auto, terminals, requested, shown, unavailable, started, startAuto>>

TypeOK == /\ auto \in BOOLEAN /\ terminals \subseteq Ids
          /\ requested \in Ids \cup {0} /\ shown \in Ids \cup {0}
          /\ unavailable \in BOOLEAN /\ started \in BOOLEAN
          /\ startAuto \in BOOLEAN

Init == /\ auto = FALSE /\ terminals = {} /\ requested = 0
        /\ shown = 0 /\ unavailable = FALSE
        /\ started = FALSE /\ startAuto = FALSE

SetAuto == /\ auto' \in BOOLEAN
           /\ started' = FALSE
           /\ UNCHANGED <<terminals, requested, shown, unavailable, startAuto>>

Start(id) == /\ id \in Ids /\ terminals' = terminals \cup {id}
             /\ shown' = IF auto THEN id ELSE 0
             /\ requested' = 0 /\ unavailable' = FALSE
             /\ started' = TRUE /\ startAuto' = auto /\ UNCHANGED auto

Close(id) == /\ id \in terminals /\ terminals' = terminals \ {id}
             /\ requested' = 0 /\ shown' = 0 /\ unavailable' = FALSE
             /\ started' = FALSE /\ UNCHANGED <<auto, startAuto>>

Show(id) == /\ id \in Ids /\ requested' = id
            /\ shown' = IF id \in terminals THEN id ELSE 0
            /\ unavailable' = (id \notin terminals)
            /\ started' = FALSE /\ UNCHANGED <<auto, terminals, startAuto>>

Next == SetAuto \/ (\E id \in Ids: Start(id) \/ Close(id) \/ Show(id))
Spec == Init /\ [][Next]_vars

StartRespectsPreference ==
    started => (IF startAuto THEN shown # 0 ELSE shown = 0)
ShowExact ==
    requested # 0 /\ ~unavailable => shown = requested /\ shown \in terminals
MissingReported ==
    requested # 0 /\ requested \notin terminals => unavailable /\ shown = 0
AvailableShown ==
    requested # 0 /\ requested \in terminals =>
        ~unavailable /\ shown = requested
================================================================================
