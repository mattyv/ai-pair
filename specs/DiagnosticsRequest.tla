---- MODULE DiagnosticsRequest -------------------------------------------------
EXTENDS Naturals, FiniteSets

VARIABLES session, owner, paused, queue, request, response, facts
vars == <<session, owner, paused, queue, request, response, facts>>

Init == /\ session \in {"idle", "active", "suspended"}
        /\ owner \in {"none", "A"}
        /\ paused \in BOOLEAN /\ queue \in 0..1
        /\ request = "none" /\ response = "none" /\ facts = {}
Request == /\ request = "none" /\ request' = "pending"
           /\ UNCHANGED <<session, owner, paused, queue, response, facts>>
Complete == /\ request = "pending"
            /\ request' = "done" /\ response' \in {"ok", "unavailable"}
            /\ facts' \in SUBSET {"version", "state", "events"}
            /\ UNCHANGED <<session, owner, paused, queue>>
Cancel == /\ request = "pending" /\ request' = "done"
          /\ response' = "cancelled"
          /\ UNCHANGED <<session, owner, paused, queue, facts>>
Next == Request \/ Complete \/ Cancel
Spec == Init /\ [][Next]_vars /\ WF_vars(Complete \/ Cancel)
TypeOK == /\ session \in {"idle", "active", "suspended"}
          /\ owner \in {"none", "A"} /\ paused \in BOOLEAN /\ queue \in 0..1
          /\ request \in {"none", "pending", "done"}
          /\ response \in {"none", "ok", "unavailable", "cancelled"}
Isolation == [][UNCHANGED <<session, owner, paused, queue>>]_vars
Allowlist == facts \subseteq {"version", "state", "events"}
Outcome == (request = "done") = (response # "none")
EventuallyResponds == request = "pending" ~> request = "done"
================================================================================
