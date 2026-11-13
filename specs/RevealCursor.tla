---- MODULE RevealCursor -------------------------------------------------------
EXTENDS Naturals

VARIABLES cursor, visible, paused, turn, requested, shown
vars == <<cursor, visible, paused, turn, requested, shown>>

Init == /\ cursor \in {"none", "agent"}
        /\ visible = "other"
        /\ paused \in BOOLEAN
        /\ turn \in {"agent", "programmer"}
        /\ requested = FALSE
        /\ shown = FALSE

Request == /\ ~requested
           /\ requested' = TRUE
           /\ UNCHANGED <<cursor, visible, paused, turn, shown>>

Show == /\ requested /\ ~shown
        /\ visible' = IF cursor = "agent" THEN cursor ELSE visible
        /\ shown' = TRUE
        /\ UNCHANGED <<cursor, paused, turn, requested>>

Next == Request \/ Show
Spec == Init /\ [][Next]_vars /\ WF_vars(Request) /\ WF_vars(Show)
TypeOK == /\ cursor \in {"none", "agent"}
          /\ visible \in {"other", "agent"}
          /\ paused \in BOOLEAN
          /\ turn \in {"agent", "programmer"}
          /\ requested \in BOOLEAN
          /\ shown \in BOOLEAN
ShowsCursor == shown /\ cursor = "agent" => visible = cursor
NoCursorNoNavigation == cursor = "none" => visible = "other"
EventuallyHandled == <>shown
PreservesPlayback == [][paused' = paused /\ turn' = turn]_vars
================================================================================
