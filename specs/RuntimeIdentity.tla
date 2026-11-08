---- MODULE RuntimeIdentity ----------------------------------------------------
EXTENDS Naturals
CONSTANT Match
ASSUME Match \in BOOLEAN
VARIABLE phase
vars == <<phase>>
Init == phase = "idle"
Start == /\ phase = "idle"
         /\ phase' = IF Match THEN "forwarded" ELSE "mismatch"
Next == Start
Spec == Init /\ [][Next]_vars /\ WF_vars(Start)
Safe == phase = "forwarded" => Match
Settles == <> (phase \in {"forwarded", "mismatch"})
=============================================================================
