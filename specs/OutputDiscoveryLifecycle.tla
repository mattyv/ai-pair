---- MODULE OutputDiscoveryLifecycle -------------------------------------------
EXTENDS Naturals
VARIABLES disposed, pending, listed
vars == <<disposed, pending, listed>>
TypeOK == /\ disposed \in BOOLEAN /\ pending \in BOOLEAN
          /\ listed \in BOOLEAN
Init == /\ disposed = FALSE /\ pending = TRUE /\ listed = FALSE
Dispose == /\ ~disposed /\ disposed' = TRUE
           /\ UNCHANGED <<pending, listed>>
Complete == /\ pending /\ pending' = FALSE
            /\ listed' = IF disposed THEN listed ELSE TRUE
            /\ UNCHANGED disposed
Next == Dispose \/ Complete
Spec == Init /\ [][Next]_vars /\ WF_vars(Complete)
NoLateList == [][disposed => listed' = listed]_vars
Completion == [](pending => <>~pending)
================================================================================
