---- MODULE ReadyCount ---------------------------------------------------------
EXTENDS Naturals
\* Counts accepted batches that have not started. Display updates atomically
\* with queue changes; interruption discards queued batches and session close
\* clears the count. Playback and approval states are separate from this count.
VARIABLES ready, shown, active, draining
vars == <<ready, shown, active, draining>>
Init == /\ ready = 0 /\ shown = 0 /\ active = TRUE /\ draining = FALSE
Accept == /\ active /\ ~draining /\ ready < 2 /\ ready' = ready + 1
          /\ shown' = ready' /\ UNCHANGED <<active, draining>>
Start == /\ active /\ ready > 0 /\ ready' = ready - 1
         /\ shown' = ready' /\ UNCHANGED <<active, draining>>
Discard == /\ active /\ ready > 0 /\ ready' = 0 /\ shown' = 0
           /\ UNCHANGED <<active, draining>>
Close == /\ active /\ active' = FALSE /\ ready' = 0 /\ shown' = 0
         /\ UNCHANGED draining
Drain == /\ active /\ ~draining /\ draining' = TRUE
         /\ UNCHANGED <<ready, shown, active>>
Next == Accept \/ Start \/ Discard \/ Close \/ Drain
Spec == Init /\ [][Next]_vars /\ WF_vars(Start)
TypeOK == /\ ready \in 0..2 /\ shown \in 0..2 /\ active \in BOOLEAN
          /\ draining \in BOOLEAN
Accurate == shown = ready
ClosedEmpty == ~active => shown = 0
Drains == (active /\ draining) ~> (shown = 0)
================================================================================
