---- MODULE ReplyHistory -------------------------------------------------------
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS Messages, Limit
ASSUME Messages # {} /\ Limit \in Nat \ {0}
VARIABLES history, index, draft, box
vars == <<history, index, draft, box>>
Init == /\ history = <<>> /\ index = 0 /\ draft = "" /\ box = ""
Send(m) ==
    /\ m \in Messages
    /\ history' = IF Len(history) < Limit THEN Append(history, m)
                   ELSE Append(Tail(history), m)
    /\ index' = Len(history')
    /\ draft' = "" /\ box' = ""
Edit(m) == /\ m \in Messages /\ box' = m /\ UNCHANGED <<history, index, draft>>
Up ==
    /\ index > 0
    /\ draft' = IF index = Len(history) THEN box ELSE draft
    /\ index' = index - 1
    /\ box' = history[index]
    /\ UNCHANGED history
Down ==
    /\ index < Len(history)
    /\ index' = index + 1
    /\ box' = IF index' = Len(history) THEN draft ELSE history[index' + 1]
    /\ UNCHANGED <<history, draft>>
Next == (\E m \in Messages: Send(m) \/ Edit(m)) \/ Up \/ Down
Spec == Init /\ [][Next]_vars
TypeOK == /\ history \in Seq(Messages) /\ Len(history) <= Limit
          /\ index \in 0..Len(history) /\ draft \in Messages \cup {""}
          /\ box \in Messages \cup {""}
EnabledNavigation == /\ (index > 0 => ENABLED Up)
                     /\ (index < Len(history) => ENABLED Down)
                     /\ ENABLED (\E m \in Messages: Send(m))
RestoreDraft == [][((Down /\ index' = Len(history)) => box' = draft)]_vars
RecallNewest == [][((Up /\ index = Len(history)) => box' = history[index])]_vars
================================================================================
