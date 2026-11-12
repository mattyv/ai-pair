---- MODULE OpenRouterSpeech ---------------------------------------------------
EXTENDS Naturals, TLC

CONSTANTS AuthSucceeds, EnableAuth, EnableSelect, EnableSynthesize
VARIABLES catalog, authenticated, narrowed, result, policy, requestPolicy
vars == <<catalog, authenticated, narrowed, result, policy, requestPolicy>>

TypeOK == /\ catalog \in {"none", "account", "failed"}
          /\ authenticated \in BOOLEAN /\ narrowed \in BOOLEAN
          /\ policy \in BOOLEAN /\ requestPolicy \in BOOLEAN
          /\ result \in {"none", "available", "requested"}
Init == /\ catalog = "none" /\ authenticated = FALSE /\ narrowed = FALSE
        /\ result = "none" /\ policy = FALSE /\ requestPolicy = FALSE

Authenticate == /\ EnableAuth /\ catalog = "none" /\ catalog' = "account"
                /\ authenticated' = TRUE
                /\ UNCHANGED <<narrowed, result, policy, requestPolicy>>
AuthFailure == /\ catalog = "none" /\ catalog' = "failed"
               /\ UNCHANGED <<authenticated, narrowed, result,
                              policy, requestPolicy>>
Narrow == /\ catalog = "account" /\ policy /\ ~narrowed
          /\ narrowed' = TRUE
          /\ UNCHANGED <<catalog, authenticated, result, policy, requestPolicy>>
Select == /\ EnableSelect /\ catalog = "account" /\ (~policy \/ narrowed)
          /\ result = "none" /\ result' = "available"
          /\ UNCHANGED <<catalog, authenticated, narrowed, policy,
                         requestPolicy>>
Toggle == /\ result = "none" /\ policy' = ~policy
          /\ UNCHANGED <<catalog, authenticated, narrowed, result,
                         requestPolicy>>
Synthesize == /\ EnableSynthesize /\ result = "available"
              /\ result' = "requested" /\ requestPolicy' = policy
              /\ UNCHANGED <<catalog, authenticated, narrowed, policy>>
Resolve == IF AuthSucceeds THEN Authenticate ELSE AuthFailure
Next == Resolve \/ Narrow \/ Select \/ Toggle \/ Synthesize
Spec == Init /\ [][Next]_vars /\ WF_vars(Resolve) /\ WF_vars(Narrow)
        /\ WF_vars(Select) /\ WF_vars(Synthesize)
AccountOnly == result # "none" => authenticated
ZdrSelection == result # "none" /\ policy => narrowed
PolicySampled == result = "requested" => requestPolicy = policy
StableProgress == (<>[]policy \/ <>[]~policy) =>
                  <> (result = "requested" \/ catalog = "failed")
================================================================================
