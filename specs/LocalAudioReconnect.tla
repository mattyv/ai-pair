---- MODULE LocalAudioReconnect ------------------------------------------------
(***************************************************************************)
(* A remote window's connection to its AI Pair Local Audio companion can  *)
(* be lost when either extension host stalls past the acknowledgement     *)
(* bound (#127). Instead of giving up for good, the workspace retries the  *)
(* prepare and commit handshake with a new connection epoch, a bounded     *)
(* number of times, and warns only when every attempt has failed. The     *)
(* companion lets a commit for a new epoch replace its attachment: it      *)
(* retires the old session first, and starts the new one once retirement  *)
(* settles. The workspace may give up on an attempt while the companion   *)
(* is still retiring, and start another, so starts can queue. The         *)
(* companion's one view provider keeps the open Pair view and hands it to *)
(* each session it starts; the programmer may close the view meanwhile.   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxAttempts, MaxLosses, MaxCloses,
          GuardRetry, GuardEpoch, GuardQueue, GuardView

\* Workspace. epoch: its current connection epoch. state: "connected",
\* "lost", "waiting" (an attempt's commit is unanswered), or "failed" (gave
\* up and warned). attempts: retries since the last loss. losses: a bound.
\* warned: the programmer was told to reload.
\* Companion. attached: the epoch its gate is attached to, or 0. sessions:
\* the epochs of its live sessions. retiring: an old session is still being
\* disposed. queued: epochs whose session waits on that retirement to start.
\* view: the slot's view, "live", "none" (closed, forgotten), or "dead"
\* (closed, still kept). closes: a bound. deadView: a session was handed a
\* closed view. stale: a frame of an old epoch was accepted.
VARIABLES epoch, state, attempts, losses, warned,
          attached, sessions, retiring, queued, view, closes, deadView, stale
vars == <<epoch, state, attempts, losses, warned,
          attached, sessions, retiring, queued, view, closes, deadView, stale>>

Init == /\ epoch = 1 /\ state = "connected" /\ attempts = 0 /\ losses = 0
        /\ warned = FALSE /\ attached = 1 /\ sessions = {1}
        /\ retiring = FALSE /\ queued = {} /\ view = "live" /\ closes = 0
        /\ deadView = FALSE /\ stale = FALSE

\* A stall past the bound: the workspace gives up on the connection. The
\* companion's session lives on until it is replaced. Without GuardRetry,
\* the old design: the workspace warns at once and stays failed.
Lose ==
    /\ state = "connected" /\ losses < MaxLosses
    /\ losses' = losses + 1 /\ attempts' = 0
    /\ IF GuardRetry
         THEN /\ state' = "lost" /\ UNCHANGED warned
         ELSE /\ state' = "failed" /\ warned' = TRUE
    /\ UNCHANGED <<epoch, attached, sessions, retiring, queued, view, closes,
                   deadView, stale>>

\* The workspace starts an attempt with a new epoch.
Attempt ==
    /\ state = "lost" /\ attempts < MaxAttempts
    /\ epoch' = epoch + 1 /\ attempts' = attempts + 1
    /\ state' = "waiting"
    /\ UNCHANGED <<losses, warned, attached, sessions, retiring, queued, view,
                   closes, deadView, stale>>

\* The companion takes the prepare and commit for the workspace's epoch. It
\* retires a live session; while one is retiring, the new session queues
\* behind it, else it starts now with the slot's view. With GuardQueue a
\* commit replaces what was queued (retireSession cancels a waiting start);
\* without, every queued start runs.
CompanionCommit ==
    /\ state = "waiting" /\ attached # epoch
    /\ attached' = epoch
    /\ IF retiring \/ sessions # {}
         THEN /\ retiring' = TRUE /\ sessions' = {}
              /\ queued' = IF GuardQueue THEN {epoch} ELSE queued \cup {epoch}
              /\ UNCHANGED deadView
         ELSE /\ sessions' = {epoch} /\ UNCHANGED <<retiring, queued>>
              /\ deadView' = (deadView \/ view = "dead")
    /\ UNCHANGED <<epoch, state, attempts, losses, warned, view, closes,
                   stale>>

\* The old session's disposal settles: the queued sessions start, each
\* handed the slot's view.
RetireDone ==
    /\ retiring
    /\ retiring' = FALSE /\ sessions' = sessions \cup queued /\ queued' = {}
    /\ deadView' = (deadView \/ (queued # {} /\ view = "dead"))
    /\ UNCHANGED <<epoch, state, attempts, losses, warned, attached, view,
                   closes, stale>>

\* The companion answers the commit once the epoch's session has started.
WorkspaceAck ==
    /\ state = "waiting" /\ attached = epoch /\ epoch \in sessions
    /\ state' = "connected"
    /\ UNCHANGED <<epoch, attempts, losses, warned, attached, sessions,
                   retiring, queued, view, closes, deadView, stale>>

\* An attempt fails: its wait timed out, perhaps while the companion was
\* still retiring, or the companion refused it. The last attempt warns.
AttemptFails ==
    /\ state = "waiting"
    /\ IF attempts = MaxAttempts
         THEN /\ state' = "failed" /\ warned' = TRUE
         ELSE /\ state' = "lost" /\ UNCHANGED warned
    /\ UNCHANGED <<epoch, attempts, losses, attached, sessions, retiring,
                   queued, view, closes, deadView, stale>>

\* The programmer closes the Pair view. With GuardView the slot forgets it;
\* without, it keeps the disposed view and hands it to the next session.
CloseView ==
    /\ view = "live" /\ closes < MaxCloses
    /\ view' = (IF GuardView THEN "none" ELSE "dead")
    /\ closes' = closes + 1
    /\ UNCHANGED <<epoch, state, attempts, losses, warned, attached, sessions,
                   retiring, queued, deadView, stale>>

\* The programmer opens the Pair view again: VS Code resolves a new view,
\* which the slot keeps and hands to the current session.
OpenView ==
    /\ view # "live"
    /\ view' = "live"
    /\ UNCHANGED <<epoch, state, attempts, losses, warned, attached, sessions,
                   retiring, queued, closes, deadView, stale>>

\* A frame of an earlier epoch, delayed in the link, reaches the companion.
\* With GuardEpoch it is accepted only by a session of its own epoch;
\* without, by any session.
LateFrame ==
    /\ epoch > 1 /\ sessions # {}
    /\ \E old \in 1..(epoch - 1) :
         stale' = (stale \/ (old \notin sessions /\ ~GuardEpoch))
    /\ UNCHANGED <<epoch, state, attempts, losses, warned, attached, sessions,
                   retiring, queued, view, closes, deadView>>

Next == Lose \/ Attempt \/ CompanionCommit \/ RetireDone \/ WorkspaceAck
        \/ AttemptFails \/ CloseView \/ OpenView \/ LateFrame

Spec == Init /\ [][Next]_vars /\ WF_vars(Attempt) /\ WF_vars(RetireDone)
        /\ WF_vars(WorkspaceAck \/ AttemptFails)

MaxEpoch == 1 + MaxLosses * MaxAttempts

TypeOK ==
    /\ epoch \in 1..MaxEpoch
    /\ state \in {"connected", "lost", "waiting", "failed"}
    /\ attempts \in 0..MaxAttempts /\ losses \in 0..MaxLosses
    /\ warned \in BOOLEAN /\ attached \in 0..MaxEpoch
    /\ sessions \subseteq 1..MaxEpoch /\ retiring \in BOOLEAN
    /\ queued \subseteq 1..MaxEpoch
    /\ view \in {"live", "none", "dead"} /\ closes \in 0..MaxCloses
    /\ deadView \in BOOLEAN /\ stale \in BOOLEAN

\* At most one companion session at a time.
SingleSession == Cardinality(sessions) <= 1
\* A connected workspace talks to a live session of its own epoch.
ConnectedIsLive == state = "connected" => epoch \in sessions
\* No session is handed a view the programmer closed.
NoDeadView == ~deadView
\* A frame of an old epoch is never accepted.
NoStaleFrame == ~stale
\* The programmer is told to reload only after every attempt failed.
NoNeedlessWarning == warned => attempts = MaxAttempts
\* Something happens: a loss ends connected again, or warned.
LossSettles == (state = "lost") ~> (state \in {"connected", "failed"})
================================================================================
