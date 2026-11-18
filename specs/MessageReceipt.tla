---- MODULE MessageReceipt -----------------------------------------------------
(***************************************************************************)
(* The panel shows a programmer message waiting until a report carrying   *)
(* it is handed to the agent, then received (#117). A report put back     *)
(* unseen makes its messages wait again; one the agent may have seen      *)
(* keeps them received. The shown state survives a page reload.           *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS Msgs, MaxRestores, MaxDrops,
          GuardEarly, GuardUnseen, GuardRepeat, GuardReload

\* where: "unsent", "held" (deferred behind the playing action), "queued"
\* (in the session's events), "out" (in a report handed to the agent), or
\* "taken" (the call completed). seen: a report carrying it may have
\* reached the agent. shown: the panel's state for it.
VARIABLES where, seen, shown, connected, restores, drops
vars == <<where, seen, shown, connected, restores, drops>>

Init == /\ where = [m \in Msgs |-> "unsent"]
        /\ seen = [m \in Msgs |-> FALSE]
        /\ shown = [m \in Msgs |-> "none"]
        /\ connected = TRUE /\ restores = 0 /\ drops = 0

\* Sending posts the message waiting. Without GuardEarly, the old idea of
\* marking a message received as soon as it is queued.
Send(m) ==
    /\ where[m] = "unsent"
    /\ \E w \in {"held", "queued"} : where' = [where EXCEPT ![m] = w]
    /\ shown' = [shown EXCEPT ![m] = IF GuardEarly THEN "waiting"
                                     ELSE "received"]
    /\ UNCHANGED <<seen, connected, restores, drops>>

\* The playing action finishes, or something flushes the held messages.
Flush ==
    /\ \E m \in Msgs : where[m] = "held"
    /\ where' = [m \in Msgs |-> IF where[m] = "held" THEN "queued"
                                ELSE where[m]]
    /\ UNCHANGED <<seen, shown, connected, restores, drops>>

\* A connected agent's call takes every queued message in one report.
Report ==
    /\ connected
    /\ \E m \in Msgs : where[m] = "queued"
    /\ LET out == {m \in Msgs : where[m] = "queued"} IN
         /\ where' = [m \in Msgs |-> IF m \in out THEN "out" ELSE where[m]]
         /\ seen' = [m \in Msgs |-> seen[m] \/ m \in out]
         /\ shown' = [m \in Msgs |-> IF m \in out THEN "received"
                                     ELSE shown[m]]
    /\ UNCHANGED <<connected, restores, drops>>

\* The call returns to the agent: its messages are delivered.
Take ==
    /\ \E m \in Msgs : where[m] = "out"
    /\ where' = [m \in Msgs |-> IF where[m] = "out" THEN "taken"
                                ELSE where[m]]
    /\ UNCHANGED <<seen, shown, connected, restores, drops>>

\* The report raced a cancellation before the agent saw it: put back, and
\* its messages wait again. Without GuardUnseen they stay received.
RestoreUnseen ==
    /\ restores < MaxRestores
    /\ \E m \in Msgs : where[m] = "out"
    /\ LET out == {m \in Msgs : where[m] = "out"} IN
         /\ where' = [m \in Msgs |-> IF m \in out THEN "queued"
                                     ELSE where[m]]
         /\ seen' = [m \in Msgs |-> IF m \in out THEN FALSE ELSE seen[m]]
         /\ shown' = [m \in Msgs |-> IF m \in out /\ GuardUnseen
                                     THEN "waiting" ELSE shown[m]]
    /\ restores' = restores + 1
    /\ UNCHANGED <<connected, drops>>

\* The cancellation came after the answer: put back, but the agent may have
\* seen it, so its messages stay received. Without GuardRepeat they wait.
RestoreRepeat ==
    /\ restores < MaxRestores
    /\ \E m \in Msgs : where[m] = "out"
    /\ LET out == {m \in Msgs : where[m] = "out"} IN
         /\ where' = [m \in Msgs |-> IF m \in out THEN "queued"
                                     ELSE where[m]]
         /\ shown' = [m \in Msgs |-> IF m \in out /\ ~GuardRepeat
                                     THEN "waiting" ELSE shown[m]]
    /\ restores' = restores + 1
    /\ UNCHANGED <<seen, connected, drops>>

\* The agent disconnects (the session suspends) and later reconnects.
Drop ==
    /\ connected /\ drops < MaxDrops
    /\ connected' = FALSE /\ drops' = drops + 1
    /\ UNCHANGED <<where, seen, shown, restores>>

Reconnect ==
    /\ ~connected /\ connected' = TRUE
    /\ UNCHANGED <<where, seen, shown, restores, drops>>

\* The page reloads and replays the panel's log, which keeps the receipts.
\* Without GuardReload, a replay that forgets them shows every sent message
\* waiting.
Reload ==
    /\ \E m \in Msgs : shown[m] # "none"
    /\ shown' = IF GuardReload THEN shown
                ELSE [m \in Msgs |-> IF shown[m] = "none" THEN "none"
                                     ELSE "waiting"]
    /\ UNCHANGED <<where, seen, connected, restores, drops>>

Next == \/ \E m \in Msgs : Send(m)
        \/ Flush \/ Report \/ Take \/ RestoreUnseen \/ RestoreRepeat
        \/ Drop \/ Reconnect \/ Reload

Spec == Init /\ [][Next]_vars /\ WF_vars(Flush) /\ WF_vars(Report)
        /\ WF_vars(Take) /\ WF_vars(Reconnect)

TypeOK ==
    /\ where \in [Msgs -> {"unsent", "held", "queued", "out", "taken"}]
    /\ seen \in [Msgs -> BOOLEAN]
    /\ shown \in [Msgs -> {"none", "waiting", "received"}]
    /\ connected \in BOOLEAN
    /\ restores \in 0..MaxRestores /\ drops \in 0..MaxDrops

\* Received only once a report carrying the message was handed out.
NoFalseReceipt == \A m \in Msgs : shown[m] = "received" => seen[m]
\* A message the agent may have seen is never shown waiting.
NoSeenWaiting == \A m \in Msgs : seen[m] => shown[m] = "received"
\* Something happens: every sent message is eventually shown received.
ReceiptProgress ==
    \A m \in Msgs : (shown[m] = "waiting") ~> (shown[m] = "received")
================================================================================
