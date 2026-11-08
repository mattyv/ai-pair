---- MODULE DiagnosticsCopy ----------------------------------------------------
(******************************************************************************)
(* The panel copies diagnostics only on a deliberate request.               *)
(******************************************************************************)
EXTENDS Naturals

VARIABLES requested, copied, failed
vars == <<requested, copied, failed>>

TypeOK == /\ requested \in BOOLEAN /\ copied \in BOOLEAN
          /\ failed \in BOOLEAN
Init == /\ requested = FALSE /\ copied = FALSE /\ failed = FALSE
Click == /\ requested' = TRUE /\ copied' \in BOOLEAN
         /\ failed' = ~copied'
Reset == /\ requested' = FALSE /\ copied' = FALSE /\ failed' = FALSE
Next == Click \/ Reset
Spec == Init /\ [][Next]_vars
OnlyOnRequest == copied => requested
RequestedCompletes == requested => copied \/ failed
ExclusiveOutcome == ~(copied /\ failed)
================================================================================
