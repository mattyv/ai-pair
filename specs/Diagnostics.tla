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
    batches,
    warned,
    caveat,
    caveatCount
vars == <<edited, observed, available, desired, result, batches,
          warned, caveat, caveatCount>>

TypeOK == /\ edited \in BOOLEAN
          /\ observed \in BOOLEAN
          /\ available \in BOOLEAN
          /\ desired \in Outcomes
          /\ result \in {"none", "completed", "interrupted", "failed"}
          /\ batches \in Nat
          /\ warned \in BOOLEAN
          /\ caveat \in BOOLEAN
          /\ caveatCount \in Nat

Init == /\ edited = FALSE
        /\ observed = FALSE
        /\ available \in BOOLEAN
        /\ desired \in Outcomes
        /\ result = "none"
        /\ batches = 0
        /\ warned = FALSE
        /\ caveat = FALSE
        /\ caveatCount = 0

Edit == /\ result = "none"
        /\ edited' = TRUE
        /\ UNCHANGED <<observed, available, desired, result, batches,
                       warned, caveat, caveatCount>>

Finish ==
    /\ result = "none"
    /\ result' = desired
    /\ observed' = (edited /\ available)
    /\ caveat' = (edited /\ ~warned)
    /\ warned' = (warned \/ edited)
    /\ caveatCount' = IF caveat' THEN caveatCount + 1 ELSE caveatCount
    /\ UNCHANGED <<edited, available, desired, batches>>

NextBatch == /\ result # "none"
             /\ batches' = batches + 1
             /\ edited' = FALSE
             /\ observed' = FALSE
             /\ available' \in BOOLEAN
             /\ desired' \in Outcomes
             /\ result' = "none"
             /\ caveat' = FALSE
             /\ UNCHANGED <<warned, caveatCount>>

Next == Edit \/ Finish \/ NextBatch
Spec == Init /\ [][Next]_vars

OnlyEdited == observed => edited
Advisory == result = "none" => ENABLED Finish
OutcomeUnchanged == result # "none" => result = desired
ObserveWhenAvailable == (edited /\ available /\ result # "none") => observed
CaveatNeedsEdit == caveat => edited
CaveatRecorded == caveat => warned
CaveatOnce == caveatCount <= 1
CaveatOnFirstEdit == (edited /\ result # "none") => warned
Constraint == batches <= MaxBatches
================================================================================
