---- MODULE RemoteCue ----------------------------------------------------------
EXTENDS Naturals
VARIABLES owner, physical, resolved, job, ack
vars == <<owner, physical, resolved, job, ack>>
Init == /\ owner = "idle" /\ physical = FALSE /\ resolved = FALSE
        /\ job = 0 /\ ack = 0
Send == /\ owner = "idle" /\ job = 0
        /\ owner' = "sent" /\ physical' = TRUE /\ job' = 1
        /\ UNCHANGED <<resolved, ack>>
Cancel == /\ owner = "sent" /\ owner' = "retiring" /\ resolved' = TRUE
          /\ UNCHANGED <<physical, job, ack>>
Retire == /\ physical /\ physical' = FALSE /\ ack' = job
          /\ UNCHANGED <<owner, resolved, job>>
Accept == /\ owner \in {"sent", "retiring"} /\ ~physical /\ ack = job
          /\ owner' = "idle" /\ resolved' = TRUE
          /\ UNCHANGED <<physical, job, ack>>
Next == Send \/ Cancel \/ Retire \/ Accept
Spec == Init /\ [][Next]_vars /\ WF_vars(Send) /\ WF_vars(Retire)
        /\ WF_vars(Accept)
TypeOK == /\ owner \in {"idle", "sent", "retiring"}
          /\ physical \in BOOLEAN /\ resolved \in BOOLEAN
          /\ job \in 0..1 /\ ack \in 0..1
NoEarlyReuse == physical => owner # "idle"
AckMatches == job = 1 /\ ~physical => ack = job
EventuallyResolved == <>resolved
================================================================================
