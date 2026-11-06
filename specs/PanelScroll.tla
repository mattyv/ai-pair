---- MODULE PanelScroll --------------------------------------------------------
(******************************************************************************)
(* The panel history's reading position, with either display order.           *)
(* A view is abstracted to one entry. Its anchor is preserved when the user  *)
(* reads away from the newest edge, including across a change of order.       *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS MaxEvents, ScrollOn
ASSUME AssumeMaxEvents == MaxEvents \in Nat
ASSUME AssumeScrollOn == ScrollOn \in {"none", "you", "all"}
EventKinds == {"entry", "you", "scroll", "switch"}
NoEntry == CHOOSE v : v \notin Nat
NoEvent == CHOOSE v : v \notin EventKinds

VARIABLES time, history, view, order, lastEvent, topBefore, wasLatest
vars == <<time, history, view, order, lastEvent, topBefore, wasLatest>>

TypeOK ==
    /\ time \in Nat
    /\ history \in Seq(Nat \ {0})
    /\ view \in (Nat \ {0}) \cup {NoEntry}
    /\ order \in {"newest", "oldest"}
    /\ lastEvent \in EventKinds \cup {NoEvent}
    /\ topBefore \in (Nat \ {0}) \cup {NoEntry}
    /\ wasLatest \in BOOLEAN

Init ==
    /\ time = 0
    /\ history = <<>>
    /\ view = NoEntry
    /\ order \in {"newest", "oldest"}
    /\ lastEvent = NoEvent
    /\ topBefore = NoEntry
    /\ wasLatest = TRUE

Add(kind) ==
    /\ time' = time + 1
    /\ history' = IF order = "newest" THEN <<time + 1>> \o history
                  ELSE history \o <<time + 1>>
    /\ view' = IF view = NoEntry \/ ScrollOn = "all"
                  \/ (ScrollOn = "you" /\ kind = "you")
                  \/ (order = "oldest" /\ view = time)
               THEN time + 1 ELSE view
    /\ lastEvent' = kind
    /\ topBefore' = view
    /\ wasLatest' = (view = time)
    /\ UNCHANGED order

AddEntry == Add("entry")
AddYours == Add("you")
Scroll ==
    /\ history # <<>>
    /\ view' \in {history[i] : i \in 1..Len(history)}
    /\ lastEvent' = "scroll"
    /\ topBefore' = NoEntry
    /\ wasLatest' = FALSE
    /\ UNCHANGED <<time, history, order>>

SwitchOrder ==
    /\ order' = IF order = "newest" THEN "oldest" ELSE "newest"
    /\ history' = [i \in 1..Len(history) |-> history[Len(history) - i + 1]]
    /\ lastEvent' = "switch"
    /\ topBefore' = view
    /\ wasLatest' = FALSE
    /\ UNCHANGED <<time, view>>

Next == AddEntry \/ AddYours \/ Scroll \/ SwitchOrder
Spec == Init /\ [][Next]_vars
ViewAtEntry == (history = <<>> /\ view = NoEntry) \/
               view \in {history[i] : i \in 1..Len(history)}
YoursInView == (lastEvent = "you") => view = time
KeepsPlace == (lastEvent = "entry" /\ topBefore # NoEntry /\
               ~(order = "oldest" /\ wasLatest)) => view = topBefore
SwitchKeepsPlace == (lastEvent = "switch") => view = topBefore
FollowsLatest == (lastEvent = "entry" /\ order = "oldest" /\ wasLatest)
                 => view = time
Constraint == time <= MaxEvents
================================================================================
