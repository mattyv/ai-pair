---- MODULE RecoveryBatchIds ---------------------------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS MaxId, PreserveCounter
VARIABLES nextId, savedNext, issued, restored, fresh, freshUsed
vars == <<nextId, savedNext, issued, restored, fresh, freshUsed>>

TypeOK == /\ nextId \in Nat \ {0}
          /\ savedNext \in Nat \ {0}
          /\ issued \subseteq (Nat \ {0})
          /\ restored \in BOOLEAN
          /\ fresh \in BOOLEAN
          /\ freshUsed \in BOOLEAN
Init == /\ nextId = 1 /\ savedNext = 1 /\ issued = {} /\ restored = FALSE /\ fresh = FALSE /\ freshUsed = FALSE
Allocate == /\ nextId <= MaxId
            /\ nextId' = nextId + 1
            /\ issued' = issued \cup {nextId}
            /\ savedNext' = nextId + 1
            /\ fresh' = FALSE
            /\ UNCHANGED <<restored, freshUsed>>
Reload == /\ ~restored
          /\ nextId' = IF PreserveCounter THEN savedNext ELSE 1
          /\ restored' = TRUE
          /\ UNCHANGED <<savedNext, issued, fresh, freshUsed>>
Fresh == /\ ~freshUsed
         /\ nextId' = 1
         /\ savedNext' = 1
         /\ issued' = {}
         /\ fresh' = TRUE
         /\ freshUsed' = TRUE
         /\ UNCHANGED restored
Next == Allocate \/ Reload \/ Fresh
Spec == Init /\ [][Next]_vars /\ WF_vars(Allocate)
Unique == nextId \notin issued
FreshStartsAtOne == fresh => nextId = 1
Progress == <> (issued # {})
================================================================================
