---- MODULE LineEndGuard -------------------------------------------------------
(******************************************************************************)
(* A batch is rehearsed before playback. An ambiguous line_end is refused   *)
(* unless explicitly acknowledged. If the live context changes, the same   *)
(* guard also prevents the move at playback. Earlier playback edits cannot   *)
(* be undone if the live context changed after rehearsal.                    *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardRehearsal, GuardPlayback

VARIABLES phase, danger, liveDanger, acknowledge, earlierEdit, crossed, rejected
vars == <<phase, danger, liveDanger, acknowledge, earlierEdit, crossed,
          rejected>>

TypeOK ==
    /\ phase \in {"rehearse", "play", "done"}
    /\ danger \in BOOLEAN
    /\ liveDanger \in BOOLEAN
    /\ acknowledge \in BOOLEAN
    /\ earlierEdit \in BOOLEAN
    /\ crossed \in BOOLEAN
    /\ rejected \in BOOLEAN

Init ==
    /\ phase = "rehearse"
    /\ danger \in BOOLEAN
    /\ liveDanger \in BOOLEAN
    /\ acknowledge \in BOOLEAN
    /\ earlierEdit = FALSE
    /\ crossed = FALSE
    /\ rejected = FALSE

Rehearse ==
    /\ phase = "rehearse"
    /\ IF GuardRehearsal /\ danger /\ ~acknowledge
       THEN /\ phase' = "done"
            /\ rejected' = TRUE
       ELSE /\ phase' = "play"
            /\ UNCHANGED rejected
    /\ UNCHANGED <<danger, liveDanger, acknowledge, earlierEdit, crossed>>

Play ==
    /\ phase = "play"
    /\ phase' = "done"
    /\ earlierEdit' = TRUE
    /\ IF GuardPlayback /\ liveDanger /\ ~acknowledge
       THEN /\ crossed' = FALSE
       ELSE /\ crossed' = TRUE
    /\ UNCHANGED <<danger, liveDanger, acknowledge, rejected>>

Next == Rehearse \/ Play
Spec == Init /\ [][Next]_vars

RejectBeforeEdits == danger /\ ~acknowledge /\ phase = "done" /\ rejected =>
    ~earlierEdit
PreflightRefuses == danger /\ ~acknowledge => phase # "play"
LiveGuard == liveDanger /\ ~acknowledge => ~crossed
AllowedActs == phase = "done" /\
    (acknowledge \/ (~danger /\ ~liveDanger)) => crossed
================================================================================
