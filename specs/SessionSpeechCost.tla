---- MODULE SessionSpeechCost --------------------------------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS MaxSession, MaxRequest
VARIABLES session, captured, issued, valid, pending, confirmed, partial
vars == <<session, captured, issued, valid, pending, confirmed, partial>>

Requests == (0..MaxSession) \X (1..MaxRequest)
TypeOK == /\ session \in 0..MaxSession
          /\ captured \subseteq Requests /\ issued \subseteq captured
          /\ valid \subseteq issued
          /\ pending \subseteq issued
          /\ confirmed \subseteq issued /\ partial \in BOOLEAN
Init == /\ session = 0 /\ captured = {} /\ issued = {} /\ valid = {}
        /\ pending = {}
        /\ confirmed = {} /\ partial = FALSE

Start == /\ session < MaxSession /\ session' = session + 1
         /\ confirmed' = {} /\ partial' = FALSE
         /\ UNCHANGED <<captured, issued, valid, pending>>
Capture == \E request \in 1..MaxRequest:
             /\ <<session, request>> \notin captured
             /\ captured' = captured \cup {<<session, request>>}
             /\ UNCHANGED <<session, issued, valid, pending, confirmed,
                            partial>>
Dispatch == \E item \in captured \ issued, succeeds \in BOOLEAN:
              /\ item[1] = session
              /\ issued' = issued \cup {item}
              /\ valid' = IF succeeds THEN valid \cup {item} ELSE valid
              /\ pending' = pending \cup {item}
              /\ UNCHANGED <<session, captured, confirmed, partial>>
ResolveItem(item) ==
             /\ item \in pending /\ item \in valid
             /\ pending' = pending \ {item}
             /\ confirmed' = IF item[1] = session
                                THEN confirmed \cup {item} ELSE confirmed
             /\ UNCHANGED <<session, captured, issued, valid, partial>>
Resolve == \E item \in Requests : ResolveItem(item)
Unavailable == \E item \in pending \ valid:
                 /\ pending' = pending \ {item}
                 /\ partial' = IF item[1] = session THEN TRUE ELSE partial
                 /\ UNCHANGED <<session, captured, issued, valid, confirmed>>
Next == Start \/ Capture \/ Dispatch \/ Resolve \/ Unavailable
Fairness == \A item \in Requests : WF_vars(ResolveItem(item))
Spec == Init /\ [][Next]_vars /\ Fairness
CurrentOnly == \A item \in confirmed: item[1] = session
NoDoubleCount == confirmed \cap pending = {}
CurrentDispatch == [][Dispatch =>
                        \A item \in issued' \ issued: item[1] = session]_vars
\* A valid current result is accounted for unless its session is replaced.
AccountingProgress ==
    \A item \in Requests :
        (item \in pending /\ item \in valid /\ item[1] = session)
        ~> (item \in confirmed \/ item[1] # session)
================================================================================
