---- MODULE FacepalmReplay -----------------------------------------------------
\* Replayed card IDs are historical data, not capabilities for a new owner.
EXTENDS Naturals
VARIABLES replayed, fresh, sent, clicks
vars == <<replayed, fresh, sent, clicks>>
Init == /\ replayed = FALSE /\ fresh = FALSE /\ sent = "none" /\ clicks = 0
Replay == /\ ~replayed /\ replayed' = TRUE /\ UNCHANGED <<fresh, sent, clicks>>
Fresh == /\ ~fresh /\ fresh' = TRUE /\ UNCHANGED <<replayed, sent, clicks>>
ClickHistory ==
  /\ replayed /\ clicks < 2 /\ clicks' = clicks + 1
  /\ UNCHANGED <<replayed, fresh, sent>>
ClickFresh ==
  /\ fresh /\ sent = "none" /\ sent' = "fresh"
  /\ UNCHANGED <<replayed, fresh, clicks>>
Next == Replay \/ Fresh \/ ClickHistory \/ ClickFresh
Spec == Init /\ [][Next]_vars /\ WF_vars(ClickFresh)
TypeOK == /\ replayed \in BOOLEAN /\ fresh \in BOOLEAN
  /\ sent \in {"none", "fresh"} /\ clicks \in 0..2
HistoryNeverSends == sent # "history"
FreshProgress == (fresh /\ sent = "none") ~> (sent = "fresh")
================================================================================
