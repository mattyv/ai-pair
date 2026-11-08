---- MODULE ListeningHint ------------------------------------------------------
(******************************************************************************)
(* The Your move explanation is available only while that status is shown.   *)
(******************************************************************************)
EXTENDS Naturals

VARIABLES active, suspended, paused, confirming, agentTurn, listening, hint
vars == <<active, suspended, paused, confirming, agentTurn, listening, hint>>

Eligible == active /\ ~suspended /\ ~paused /\ ~confirming /\
            agentTurn /\ listening
TypeOK == /\ active \in BOOLEAN /\ suspended \in BOOLEAN /\ paused \in BOOLEAN
          /\ confirming \in BOOLEAN /\ agentTurn \in BOOLEAN
          /\ listening \in BOOLEAN /\ hint \in BOOLEAN
Init == /\ active = FALSE /\ suspended = FALSE /\ paused = FALSE
        /\ confirming = FALSE /\ agentTurn = TRUE /\ listening = FALSE
        /\ hint = FALSE
Update ==
    /\ active' \in BOOLEAN /\ suspended' \in BOOLEAN /\ paused' \in BOOLEAN
    /\ confirming' \in BOOLEAN /\ agentTurn' \in BOOLEAN
    /\ listening' \in BOOLEAN
    /\ hint' = (active' /\ ~suspended' /\ ~paused' /\ ~confirming' /\
                agentTurn' /\ listening')
Next == Update
Spec == Init /\ [][Next]_vars
HintMatchesStatus == hint <=> Eligible
================================================================================
