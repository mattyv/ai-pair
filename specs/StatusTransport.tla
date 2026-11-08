---- MODULE StatusTransport ----------------------------------------------------
EXTENDS Naturals
CONSTANTS WorkspaceVersion, CompanionVersion
VARIABLES attached, delivered, warned
vars == <<attached, delivered, warned>>
Init == /\ attached = FALSE /\ delivered = FALSE /\ warned = FALSE
Attach == /\ ~attached /\ ~warned
          /\ IF WorkspaceVersion = CompanionVersion
                THEN /\ attached' = TRUE /\ UNCHANGED warned
                ELSE /\ warned' = TRUE /\ UNCHANGED attached
          /\ UNCHANGED delivered
Send == /\ attached /\ delivered' = TRUE /\ UNCHANGED <<attached, warned>>
Next == Attach \/ Send
Spec == Init /\ [][Next]_vars /\ WF_vars(Attach) /\ WF_vars(Send)
TypeOK == /\ attached \in BOOLEAN /\ delivered \in BOOLEAN /\ warned \in BOOLEAN
NoMixedAttach == attached => WorkspaceVersion = CompanionVersion
NoMixedDelivery == delivered => WorkspaceVersion = CompanionVersion
MixedWarns == WorkspaceVersion # CompanionVersion ~> warned
MatchingDelivers == WorkspaceVersion = CompanionVersion ~> delivered
================================================================================
