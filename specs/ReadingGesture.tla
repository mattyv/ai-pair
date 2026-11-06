---- MODULE ReadingGesture -----------------------------------------------------
(******************************************************************************)
(* A physical press remains bound to the countdown present at press time.     *)
(******************************************************************************)
EXTENDS Naturals
CONSTANTS MaxId
ASSUME Bounded == MaxId \in Nat \ {0}
VARIABLES reading, pressedId, pendingId, long, suppress, sent, clickOccurred,
          clickedReading, clickedId, clickedSuppress
vars == <<reading, pressedId, pendingId, long, suppress, sent, clickOccurred,
          clickedReading, clickedId, clickedSuppress>>
TypeOK ==
    /\ reading \in 1..MaxId
    /\ pressedId \in 0..MaxId /\ pendingId \in 0..MaxId
    /\ long \in BOOLEAN /\ suppress \in BOOLEAN
    /\ sent \in 0..MaxId /\ clickOccurred \in BOOLEAN
    /\ clickedReading \in 0..MaxId /\ clickedId \in 0..MaxId
    /\ clickedSuppress \in BOOLEAN
Init ==
    /\ reading = 1 /\ pressedId = 0 /\ pendingId = 0
    /\ long = FALSE /\ suppress = FALSE /\ sent = 0
    /\ clickOccurred = FALSE /\ clickedReading = 0 /\ clickedId = 0
    /\ clickedSuppress = FALSE
Press ==
    /\ pressedId = 0 /\ pressedId' = reading /\ long' = FALSE
    /\ pendingId' = 0 /\ suppress' = FALSE /\ clickOccurred' = FALSE
    /\ UNCHANGED <<reading, sent, clickedReading, clickedId, clickedSuppress>>
Long ==
    /\ pressedId # 0 /\ long' = TRUE /\ clickOccurred' = FALSE
    /\ UNCHANGED <<reading, pressedId, pendingId, suppress, sent,
                   clickedReading, clickedId, clickedSuppress>>
NewReading ==
    /\ reading' \in 1..MaxId /\ clickOccurred' = FALSE
    /\ UNCHANGED <<pressedId, pendingId, long, suppress, sent, clickedReading,
                   clickedId, clickedSuppress>>
Release ==
    /\ pressedId # 0 /\ pendingId' = pressedId /\ pressedId' = 0
    /\ suppress' = long /\ clickOccurred' = FALSE
    /\ UNCHANGED <<reading, long, sent, clickedReading, clickedId,
                   clickedSuppress>>
Click ==
    /\ pendingId # 0
    /\ clickOccurred' = TRUE /\ clickedReading' = reading
    /\ clickedId' = pendingId /\ clickedSuppress' = suppress
    /\ sent' = IF ~suppress /\ pendingId = reading THEN reading ELSE 0
    /\ pendingId' = 0 /\ suppress' = FALSE
    /\ UNCHANGED <<reading, pressedId, long>>
Next == Press \/ Long \/ NewReading \/ Release \/ Click
Spec == Init /\ [][Next]_vars
NoNewerSkip == (clickOccurred /\ sent # 0) =>
    (sent = clickedReading /\ sent = clickedId)
LongDoesNotSkip == (clickOccurred /\ clickedSuppress) => sent = 0
ShortCurrentSkips == (clickOccurred /\ ~clickedSuppress /\
                      clickedId = clickedReading) => sent = clickedId
================================================================================
