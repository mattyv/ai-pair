---- MODULE Diagnostics --------------------------------------------------------
(* Advisory snapshots of editor diagnostics after an applied batch. Providers *)
(* can be absent or late; the snapshot is not a guarantee of valid syntax.    *)
EXTENDS Naturals

CONSTANTS
    MaxBatches
Outcomes == {"completed", "interrupted", "failed"}
VARIABLES
    edited,
    observed,
    available,
    desired,
    result,
    batches
vars == <<edited, observed, available, desired, result, batches>>

TypeOK == /\ edited \in BOOLEAN
          /\ observed \in BOOLEAN
          /\ available \in BOOLEAN
          /\ desired \in Outcomes
          /\ result \in {"none", "completed", "interrupted", "failed"}
          /\ batches \in Nat

Init == /\ edited = FALSE
        /\ observed = FALSE
        /\ available \in BOOLEAN
        /\ desired \in Outcomes
        /\ result = "none"
        /\ batches = 0

Edit == /\ result = "none"
        /\ edited' = TRUE
        /\ UNCHANGED <<observed, available, desired, result, batches>>

Finish ==
    /\ result = "none"
    /\ result' = desired
    /\ observed' = (edited /\ available)
    /\ UNCHANGED <<edited, available, desired, batches>>

NextBatch == /\ result # "none"
             /\ batches' = batches + 1
             /\ edited' = FALSE
             /\ observed' = FALSE
             /\ available' \in BOOLEAN
             /\ desired' \in Outcomes
             /\ result' = "none"

Next == Edit \/ Finish \/ NextBatch
Spec == Init /\ [][Next]_vars

OnlyEdited == observed => edited
Advisory == result = "none" => ENABLED Finish
OutcomeUnchanged == result # "none" => result = desired
ObserveWhenAvailable == (edited /\ available /\ result # "none") => observed
Constraint == batches <= MaxBatches
================================================================================
