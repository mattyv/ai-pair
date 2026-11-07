---- MODULE SpeechWorker -------------------------------------------------------
(******************************************************************************)
(* Cancellation closes the UI gate but cannot strand an active CPU job.      *)
(******************************************************************************)
EXTENDS Naturals

VARIABLES worker, active, issued, settled, job, armed, ticks, delivered
vars == <<worker, active, issued, settled, job, armed, ticks, delivered>>

TypeOK ==
    /\ worker \in {"idle", "running", "terminating"}
    /\ active \in BOOLEAN /\ issued \in 0..2 /\ settled \in 0..2
    /\ job \in 0..2
    /\ armed \in BOOLEAN /\ ticks \in 0..2 /\ delivered \in 0..2

Init ==
    /\ worker = "idle" /\ active = FALSE /\ issued = 0 /\ settled = 0
    /\ job = 0
    /\ armed = FALSE /\ ticks = 0 /\ delivered = 0

Admit ==
    /\ worker = "idle" /\ ~active /\ issued < 2
    /\ worker' = "running" /\ active' = TRUE /\ issued' = issued + 1
    /\ job' = issued + 1 /\ armed' = TRUE /\ ticks' = 2 /\ delivered' = 0
    /\ UNCHANGED settled

Cancel ==
    /\ active /\ active' = FALSE /\ delivered' = 0
    /\ UNCHANGED <<worker, issued, settled, job, armed, ticks>>

Tick ==
    /\ worker = "running" /\ armed /\ ticks > 0
    /\ ticks' = ticks - 1
    /\ UNCHANGED <<worker, active, issued, settled, job, armed, delivered>>

Timeout ==
    /\ worker = "running" /\ armed /\ ticks = 0
    /\ worker' = "terminating" /\ armed' = FALSE
    /\ active' = FALSE /\ delivered' = 0
    /\ UNCHANGED <<issued, settled, job, ticks>>

Complete(id) ==
    /\ worker = "running" /\ id = job
    /\ worker' = "idle" /\ armed' = FALSE /\ job' = 0 /\ ticks' = 0
    /\ delivered' = (IF active THEN id ELSE 0) /\ settled' = settled + 1
    /\ UNCHANGED <<active, issued>>

Consume ==
    /\ active /\ worker = "idle" /\ active' = FALSE /\ delivered' = 0
    /\ UNCHANGED <<worker, issued, settled, job, armed, ticks>>

Terminated ==
    /\ worker = "terminating" /\ worker' = "idle" /\ job' = 0
    /\ settled' = settled + 1
    /\ UNCHANGED <<active, issued, armed, ticks, delivered>>

Next == Admit \/ Cancel \/ Tick \/ Timeout \/ Consume \/ Terminated \/
        (\E id \in 1..2 : Complete(id))
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick) /\ WF_vars(Timeout) /\
        WF_vars(Terminated)

WorkerScoped == (worker = "running") <=> (job # 0 /\ armed)
NoOverlap == issued - settled <= 1
DeliveryScoped == delivered # 0 => active /\ delivered = issued
Progress == [](worker = "running" => <> (worker # "running")) /\
            [](worker = "terminating" => <> (worker = "idle"))
================================================================================
