---- MODULE RecoveryBatchIds ---------------------------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS MaxId, PreserveCounter
VARIABLES nextId, savedNext, issued, restored
vars == <<nextId, savedNext, issued, restored>>

TypeOK == /\ nextId \in Nat \ {0}
          /\ savedNext \in Nat \ {0}
          /\ issued \subseteq (Nat \ {0})
          /\ restored \in BOOLEAN
Init == /\ nextId = 1 /\ savedNext = 1 /\ issued = {} /\ restored = FALSE
Allocate == /\ nextId <= MaxId
            /\ nextId' = nextId + 1
            /\ issued' = issued \cup {nextId}
            /\ savedNext' = nextId + 1
            /\ UNCHANGED restored
Reload == /\ ~restored
          /\ nextId' = IF PreserveCounter THEN savedNext ELSE 1
          /\ restored' = TRUE
          /\ UNCHANGED <<savedNext, issued>>
Next == Allocate \/ Reload
Spec == Init /\ [][Next]_vars /\ WF_vars(Allocate)
Unique == nextId \notin issued
Progress == <> (issued # {})
================================================================================
