---- MODULE RecoveryBatchIds ----
EXTENDS Naturals, FiniteSets
CONSTANT MaxId, PreserveCounter
VARIABLES nextId, savedNext, issued, restored
vars == <<nextId, savedNext, issued, restored>>
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
====
