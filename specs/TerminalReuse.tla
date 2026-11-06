---- MODULE TerminalReuse ------------------------------------------------------
(******************************************************************************)
(* Reuse of one owned terminal. idle with inFlight models a completed shell  *)
(* command whose output is still draining. A foreign start protects the      *)
(* terminal, including one accessed by another extension while hidden.       *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardExposed, GuardFlight, GuardForeign, ReuseEligible

VARIABLES mode, exposed, inFlight, foreign, attempted, reused
vars == <<mode, exposed, inFlight, foreign, attempted, reused>>

TypeOK ==
    /\ mode \in {"idle", "busy", "untracked", "exited"}
    /\ exposed \in BOOLEAN
    /\ inFlight \in BOOLEAN
    /\ foreign \in BOOLEAN
    /\ attempted \in BOOLEAN
    /\ reused \in BOOLEAN

Init ==
    /\ mode \in {"idle", "busy", "untracked", "exited"}
    /\ exposed \in BOOLEAN
    /\ inFlight \in BOOLEAN
    /\ foreign = FALSE
    /\ attempted = FALSE
    /\ reused = FALSE

Eligible == mode = "idle" /\ ~exposed /\ ~inFlight

ForeignStart ==
    /\ ~attempted /\ ~foreign
    /\ foreign' = TRUE
    /\ exposed' = IF GuardForeign THEN TRUE ELSE exposed
    /\ UNCHANGED <<mode, inFlight, attempted, reused>>

Attempt ==
    /\ ~attempted
    /\ attempted' = TRUE
    /\ reused' = (mode = "idle" /\ (~GuardExposed \/ ~exposed) /\
                   (~GuardFlight \/ ~inFlight) /\ ReuseEligible)
    /\ UNCHANGED <<mode, exposed, inFlight, foreign>>

Next == ForeignStart \/ Attempt
Spec == Init /\ [][Next]_vars /\ WF_vars(Attempt)

ProtectedNotReused == (attempted /\ reused) => Eligible
EligibleReused == (attempted /\ Eligible) => reused
ForeignProtected == foreign => exposed
AttemptCompletes == <>attempted
================================================================================
