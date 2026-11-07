---- MODULE PlaybackAnchor -----------------------------------------------------
(******************************************************************************)
(* The cursor is already at the marker while the editor or reading pause    *)
(* awaits. Programmer edits transform it. The group target abstracts the    *)
(* inserted range start, independently of this logical cursor.               *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxLength
ASSUME MaxLength \in Nat \ {0}

VARIABLES phase, length, anchor, expected, cursor
vars == <<phase, length, anchor, expected, cursor>>

Init == /\ phase = "reading" /\ length = MaxLength
        /\ anchor = 1 /\ expected = 1 /\ cursor = 1

MapPosition(pos, start, removed, added) ==
    IF pos <= start THEN pos
    ELSE IF pos >= start + removed THEN pos + added - removed
    ELSE start + added

UserEdit(start, removed, added) ==
    /\ phase = "reading"
    /\ start \in 0..length /\ removed \in 0..(length - start)
    /\ added \in 0..1 /\ length - removed + added <= MaxLength
    /\ length' = length - removed + added
    /\ anchor' = MapPosition(anchor, start, removed, added)
    /\ expected' = MapPosition(expected, start, removed, added)
    /\ cursor' = MapPosition(cursor, start, removed, added)
    /\ UNCHANGED phase

Finish == /\ phase = "reading" /\ phase' = "done"
          /\ UNCHANGED <<length, anchor, expected, cursor>>

Next == Finish \/ (\E start \in 0..length :
                    \E removed \in 0..(length - start) :
                      \E added \in 0..1 : UserEdit(start, removed, added))
Spec == Init /\ [][Next]_vars
ProgressSpec == Spec /\ WF_vars(Finish)
TypeOK == /\ phase \in {"reading", "done"}
          /\ length \in 0..MaxLength
          /\ anchor \in 0..length /\ expected \in 0..length
          /\ cursor \in 0..length
Target == IF phase = "reading" THEN MaxLength ELSE cursor
ReadingTargetsGroup == phase = "reading" => Target = MaxLength
FinishedTargetsCursor == phase = "done" => Target = cursor
MarkerPreserved == phase = "done" => cursor = expected
EventuallyFinished == <> (phase = "done")
================================================================================
