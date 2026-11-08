---- MODULE ModelStatus --------------------------------------------------------
EXTENDS Naturals

VARIABLES installed, verified, shown
vars == <<installed, verified, shown>>
Init == /\ installed \in BOOLEAN /\ verified = FALSE /\ shown = "unknown"
Check == /\ verified' = installed /\ shown' = IF installed THEN "verified" ELSE "unavailable"
         /\ UNCHANGED installed
Change == /\ installed' = ~installed /\ verified' = FALSE /\ shown' = "unknown"
Next == Check \/ Change
Spec == Init /\ [][Next]_vars /\ WF_vars(Check)
TypeOK == /\ installed \in BOOLEAN /\ verified \in BOOLEAN
          /\ shown \in {"unknown", "verified", "unavailable"}
VerifiedIsInstalled == shown = "verified" => installed /\ verified
StatusProgress == (shown = "unknown") ~> (shown # "unknown")
=============================================================================
