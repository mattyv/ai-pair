---- MODULE DeferredMessage ----------------------------------------------------
(***************************************************************************)
(* A reply waits for the playing action; urgent input can stop it sooner.  *)
(***************************************************************************)
EXTENDS Naturals

VARIABLES action, pending, delivered, interrupted, urgent
vars == <<action, pending, delivered, interrupted, urgent>>

Init == /\ action = "playing" /\ pending = FALSE /\ delivered = FALSE
        /\ interrupted = FALSE /\ urgent = FALSE

SendDeferred == /\ ~pending /\ ~delivered
                /\ IF action = "playing" /\ ~interrupted THEN
                     /\ pending' = TRUE
                     /\ UNCHANGED <<action, delivered, interrupted, urgent>>
                   ELSE /\ delivered' = TRUE /\ interrupted' = TRUE
                        /\ UNCHANGED <<action, pending, urgent>>

FinishAction == /\ action = "playing" /\ ~interrupted
                /\ action' = "finished"
                /\ IF pending THEN
                     /\ pending' = FALSE /\ delivered' = TRUE
                     /\ interrupted' = TRUE
                   ELSE UNCHANGED <<pending, delivered, interrupted>>
                /\ UNCHANGED urgent

Urgent == /\ ~interrupted /\ interrupted' = TRUE /\ urgent' = TRUE
          /\ IF pending THEN /\ pending' = FALSE /\ delivered' = TRUE
             ELSE UNCHANGED <<pending, delivered>>
          /\ UNCHANGED action

Next == SendDeferred \/ FinishAction \/ Urgent
Spec == Init /\ [][Next]_vars /\ WF_vars(FinishAction)

TypeOK == /\ action \in {"playing", "finished"}
          /\ pending \in BOOLEAN /\ delivered \in BOOLEAN
          /\ interrupted \in BOOLEAN /\ urgent \in BOOLEAN
NoEarlyDelivery == delivered => action = "finished" \/ urgent
UrgentIsImmediate == urgent => interrupted
PendingProgress == pending ~> delivered
================================================================================
