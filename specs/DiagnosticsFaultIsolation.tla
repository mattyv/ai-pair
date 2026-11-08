---- MODULE DiagnosticsFaultIsolation ------------------------------------------
EXTENDS Naturals

CONSTANTS GuardCatch, EnableAttempt
Sites == {"bridge", "controller", "terminal"}
Modes == {"absent", "returns", "throws"}

VARIABLES phase, site, mode, attempts, escaped
vars == <<phase, site, mode, attempts, escaped>>

Init ==
    /\ phase = "idle" /\ site = "none" /\ mode = "none"
    /\ attempts = 0 /\ escaped = FALSE

Attempt ==
    /\ EnableAttempt /\ phase = "idle"
    /\ \E s \in Sites, m \in Modes:
        /\ site' = s /\ mode' = m /\ attempts' = 1
        /\ escaped' = (m = "throws" /\ ~GuardCatch)
        /\ phase' = IF m = "throws" /\ ~GuardCatch THEN "aborted" ELSE "working"

Complete ==
    /\ phase = "working" /\ phase' = "done"
    /\ UNCHANGED <<site, mode, attempts, escaped>>

Next == Attempt \/ Complete
Spec == Init /\ [][Next]_vars /\ WF_vars(Attempt) /\ WF_vars(Complete)

TypeOK ==
    /\ phase \in {"idle", "working", "done", "aborted"}
    /\ site \in Sites \cup {"none"} /\ mode \in Modes \cup {"none"}
    /\ attempts \in 0..1 /\ escaped \in BOOLEAN
NoEscapedException == ~escaped
BusinessCompletes == (phase = "idle") ~> (phase = "done")
================================================================================
