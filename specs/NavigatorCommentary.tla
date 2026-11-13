---- MODULE NavigatorCommentary ------------------------------------------------
EXTENDS Naturals

CONSTANTS FreshProjection, RestoreOldMode
VARIABLES mode, desired, call, report, delivered, restored, stale
vars == <<mode, desired, call, report, delivered, restored, stale>>
Modes == {"quiet", "helpful", "coach"}
Init == /\ mode = "helpful" /\ desired = "helpful"
        /\ call = "none" /\ report = "none"
        /\ delivered = "none" /\ restored = FALSE
        /\ stale = FALSE
SetMode(m) == /\ m \in Modes /\ mode' = m /\ desired' = m
              /\ UNCHANGED <<call, report, delivered, restored, stale>>
Start == /\ call = "none" /\ call' = "pending"
         /\ UNCHANGED <<mode, desired, report, delivered, restored, stale>>
Commit == /\ call = "pending" /\ call' = "committed" /\ report' = mode
          /\ UNCHANGED <<mode, desired, delivered, restored, stale>>
Deliver == /\ call = "committed" /\ call' = "none"
           /\ delivered' = IF FreshProjection THEN mode ELSE report
           /\ stale' = (stale \/
                ((IF FreshProjection THEN mode ELSE report) # mode))
           /\ restored' = FALSE
           /\ UNCHANGED <<mode, desired, report>>
Cancel == /\ call = "committed" /\ call' = "none" /\ restored' = TRUE
          /\ UNCHANGED <<mode, desired, report, delivered, stale>>
Restore == /\ restored /\ call = "none"
           /\ call' = "pending" /\ restored' = FALSE
           /\ mode' = IF RestoreOldMode THEN report ELSE mode
           /\ UNCHANGED <<desired, report, delivered, stale>>
Next == (\E m \in Modes: SetMode(m)) \/ Start \/ Commit \/ Deliver
        \/ Cancel \/ Restore
Spec == Init /\ [][Next]_vars /\ WF_vars(Commit) /\ WF_vars(Deliver)
TypeOK == /\ mode \in Modes /\ desired \in Modes
          /\ call \in {"none", "pending", "committed"}
          /\ report \in Modes \cup {"none"} /\ delivered \in Modes \cup {"none"}
          /\ restored \in BOOLEAN /\ stale \in BOOLEAN
CurrentAtDelivery == ~stale
RestoreKeepsMode == mode = desired

EventuallySettled == call # "none" ~> call = "none"
================================================================================
