---- MODULE StartDirectory ----------------------------------------------------
(* A supplied working directory is authoritative. Invalid directories and   *)
(* directories without a matching editor fail before a session starts.       *)
EXTENDS Naturals
CONSTANT Strict
ASSUME Strict \in BOOLEAN
VARIABLES explicit, valid, matched, fallback, phase, selected
vars == <<explicit, valid, matched, fallback, phase, selected>>
Init ==
    /\ explicit \in BOOLEAN
    /\ valid \in BOOLEAN
    /\ matched \in BOOLEAN
    /\ fallback \in BOOLEAN
    /\ phase = "idle"
    /\ selected = "none"
Start ==
    /\ phase = "idle"
    /\ IF explicit /\ Strict
       THEN /\ phase' = IF valid /\ matched THEN "started" ELSE "rejected"
            /\ selected' = IF valid /\ matched THEN "given" ELSE "none"
       ELSE /\ phase' = IF matched \/ fallback THEN "started" ELSE "rejected"
            /\ selected' = IF matched THEN "given" ELSE IF fallback THEN "fallback" ELSE "none"
    /\ UNCHANGED <<explicit, valid, matched, fallback>>
Next == Start
Spec == Init /\ [][Next]_vars /\ WF_vars(Start)
Authoritative == explicit /\ phase = "started" => valid /\ matched /\ selected = "given"
RejectedWithoutSelection == phase = "rejected" => selected = "none"
Finishes == <>(phase # "idle")
=============================================================================
