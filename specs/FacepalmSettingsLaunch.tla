---- MODULE FacepalmSettingsLaunch ---------------------------------------------
\* A process start is not evidence that the window opened.
EXTENDS Naturals

VARIABLES phase, spawned, cleanExit, survived
vars == <<phase, spawned, cleanExit, survived>>

Init ==
  /\ phase = "idle" /\ spawned = FALSE
  /\ cleanExit = FALSE /\ survived = FALSE

Launch ==
  /\ phase = "idle" /\ phase' = "starting"
  /\ UNCHANGED <<spawned, cleanExit, survived>>

Spawn ==
  /\ phase = "starting" /\ phase' = "observing" /\ spawned' = TRUE
  /\ UNCHANGED <<cleanExit, survived>>

Fail ==
  /\ phase \in {"starting", "observing"} /\ phase' = "failed"
  /\ UNCHANGED <<spawned, cleanExit, survived>>

CleanExit ==
  /\ phase = "observing" /\ phase' = "accepted" /\ cleanExit' = TRUE
  /\ UNCHANGED <<spawned, survived>>

Grace ==
  /\ phase = "observing" /\ phase' = "accepted" /\ survived' = TRUE
  /\ UNCHANGED <<spawned, cleanExit>>

Deadline ==
  /\ phase \in {"starting", "observing"} /\ phase' = "failed"
  /\ UNCHANGED <<spawned, cleanExit, survived>>

Next == Launch \/ Spawn \/ Fail \/ CleanExit \/ Grace \/ Deadline
Spec == Init /\ [][Next]_vars /\ WF_vars(Grace) /\ WF_vars(Deadline)
TypeOK ==
  /\ phase \in {"idle", "starting", "observing", "accepted", "failed"}
  /\ spawned \in BOOLEAN /\ cleanExit \in BOOLEAN /\ survived \in BOOLEAN
AcceptedEvidence ==
  phase = "accepted" => spawned /\ (cleanExit \/ survived)
Settles == (phase \in {"starting", "observing"}) ~>
           (phase \in {"accepted", "failed"})
================================================================================
