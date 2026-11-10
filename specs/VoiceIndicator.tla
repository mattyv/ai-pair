---- MODULE VoiceIndicator -----------------------------------------------------
(***************************************************************************)
(* A toolbar projection of existing readiness facts, updated atomically.   *)
(***************************************************************************)
VARIABLES enabled, transport, prerequisites, failed, indicator, observed
vars == <<enabled, transport, prerequisites, failed, indicator, observed>>

View(e, t, p, f) ==
    IF ~e THEN "off"
    ELSE IF ~t \/ f \/ p = "unavailable" THEN "unavailable"
    ELSE IF p = "ready" THEN "ready"
    ELSE "checking"

Init ==
    /\ enabled = FALSE /\ transport = FALSE /\ prerequisites = "unknown"
    /\ failed = FALSE /\ indicator = "off" /\ observed = FALSE

Observe ==
    /\ enabled' \in BOOLEAN /\ transport' \in BOOLEAN
    /\ prerequisites' \in {"unknown", "unavailable", "ready"}
    /\ failed' \in BOOLEAN
    /\ indicator' = View(enabled', transport', prerequisites', failed')
    /\ observed' = TRUE

Next == Observe
Spec == Init /\ [][Next]_vars /\ WF_vars(Observe)
TypeOK ==
    /\ enabled \in BOOLEAN /\ transport \in BOOLEAN
    /\ prerequisites \in {"unknown", "unavailable", "ready"}
    /\ failed \in BOOLEAN
    /\ indicator \in {"off", "checking", "unavailable", "ready"}
    /\ observed \in BOOLEAN
Accurate == indicator = View(enabled, transport, prerequisites, failed)
ReadyRequiresEvidence == indicator = "ready" =>
    enabled /\ transport /\ prerequisites = "ready" /\ ~failed
OffWhenDisabled == ~enabled => indicator = "off"
EventuallyObserved == <>observed
================================================================================
