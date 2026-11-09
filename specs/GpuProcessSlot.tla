---- MODULE GpuProcessSlot -----------------------------------------------------
EXTENDS Naturals

CONSTANTS GuardClose
VARIABLES owner, live, denied, overlap
vars == <<owner, live, denied, overlap>>

Init == /\ owner = "none" /\ live = FALSE /\ denied = FALSE /\ overlap = FALSE
Acquire ==
  /\ owner = "none" /\ (~live \/ ~GuardClose)
  /\ owner' \in {"speech", "proof"} /\ live' = TRUE /\ denied' = FALSE
  /\ overlap' = (overlap \/ live)
Busy ==
  /\ owner # "none" /\ ~denied /\ denied' = TRUE
  /\ UNCHANGED <<owner, live, overlap>>
Result ==
  /\ owner # "none" /\ ~GuardClose /\ owner' = "none"
  /\ UNCHANGED <<live, denied, overlap>>
Close ==
  /\ live /\ live' = FALSE /\ owner' = "none" /\ denied' = FALSE
  /\ UNCHANGED overlap
Next == Acquire \/ Busy \/ Result \/ Close
Spec == Init /\ [][Next]_vars /\ WF_vars(Close) /\ WF_vars(Busy)
TypeOK == /\ owner \in {"none", "speech", "proof"}
          /\ live \in BOOLEAN /\ denied \in BOOLEAN /\ overlap \in BOOLEAN
Safe == ~overlap
Reaped == live ~> ~live
BusyResponds == (live /\ ~denied) ~> (denied \/ ~live)
================================================================================
