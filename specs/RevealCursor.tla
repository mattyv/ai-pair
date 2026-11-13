---- MODULE RevealCursor -------------------------------------------------------
EXTENDS Naturals

VARIABLES cursor, visible, paused, turn, requested, shown, offset, revealed,
          generation, shownGeneration
vars == <<cursor, visible, paused, turn, requested, shown, offset, revealed,
          generation, shownGeneration>>

Init == /\ cursor \in {"none", "fileA", "fileB"}
        /\ visible = "other"
        /\ paused \in BOOLEAN
        /\ turn \in {"agent", "programmer"}
        /\ requested = FALSE
        /\ shown = FALSE
        /\ offset = 0
        /\ revealed = 0
        /\ generation = 0
        /\ shownGeneration = 0

Request == /\ ~requested
           /\ requested' = TRUE
           /\ generation' = 1
           /\ UNCHANGED <<cursor, visible, paused, turn, shown, offset,
                           revealed, shownGeneration>>

Move == /\ requested /\ ~shown /\ cursor # "none" /\ offset = 0
        /\ offset' = 1
        /\ UNCHANGED <<cursor, visible, paused, turn, requested, shown,
                        revealed, generation, shownGeneration>>

MoveFile == /\ requested /\ ~shown /\ cursor = "fileA"
            /\ cursor' = "fileB"
            /\ UNCHANGED <<visible, paused, turn, requested, shown, offset,
                            revealed, generation, shownGeneration>>

Dispose == /\ requested /\ ~shown
           /\ cursor' = "none"
           /\ shown' = TRUE
           /\ shownGeneration' = generation
           /\ UNCHANGED <<visible, paused, turn, requested, offset, revealed,
                           generation>>

Supersede == /\ requested /\ ~shown /\ generation = 1
             /\ generation' = 2
             /\ UNCHANGED <<cursor, visible, paused, turn, requested, shown,
                             offset, revealed, shownGeneration>>

Show(id) == /\ requested /\ ~shown /\ id = generation
        /\ visible' = (IF cursor # "none" THEN cursor ELSE visible)
        /\ shown' = TRUE
        /\ revealed' = offset
        /\ shownGeneration' = id
        /\ UNCHANGED <<cursor, paused, turn, requested, offset, generation>>

Next == Request \/ Move \/ MoveFile \/ Dispose \/ Supersede
        \/ (\E id \in 1..2: Show(id))
Spec == Init /\ [][Next]_vars /\ WF_vars(Request)
        /\ WF_vars(\E id \in 1..2: Show(id))
TypeOK == /\ cursor \in {"none", "fileA", "fileB"}
          /\ visible \in {"other", "fileA", "fileB"}
          /\ paused \in BOOLEAN
          /\ turn \in {"agent", "programmer"}
          /\ requested \in BOOLEAN
          /\ shown \in BOOLEAN
          /\ offset \in 0..1
          /\ revealed \in 0..1
          /\ generation \in 0..2
          /\ shownGeneration \in 0..2
ShowsCursor == shown /\ cursor # "none" => visible = cursor
CurrentRequest == shown => shownGeneration = generation
LatestPosition == shown /\ cursor # "none" => revealed = offset
NoCursorNoNavigation == cursor = "none" => visible = "other"
EventuallyHandled == <>shown
PreservesPlayback == [][paused' = paused /\ turn' = turn]_vars
================================================================================
