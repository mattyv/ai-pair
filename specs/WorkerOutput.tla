---- MODULE WorkerOutput -------------------------------------------------------
EXTENDS Naturals, Sequences

\* Raw text is a distinct, bounded per-message event. The main surfaces receive
\* lifecycle events, not raw output. Text atoms abstract content and length;
\* TooLong stands for any message beyond the boundary, not one exact string.
\* Two non-reused grant identities model delayed submissions after replacement.
CONSTANTS MaxGrant, MaxHistory, Texts, TooLong, GuardCurrent, GuardBound,
          GuardPair, GuardListen, GuardStatus, GuardProjection, GuardReplay,
          GuardOrder
ASSUME /\ TooLong \notin Texts /\ MaxGrant >= 2 /\ MaxHistory >= 2

VARIABLES issued, active, history, workerView, pairChat, mainListen, status,
          badAdmission, badReplay
vars == <<issued, active, history, workerView, pairChat, mainListen, status,
          badAdmission, badReplay>>

Grants == 1..MaxGrant
Kinds == {"output", "lifecycle"}
Messages == Texts \cup {TooLong}
Events == Kinds \X Grants \X Messages

RECURSIVE Outputs(_)
Outputs(events) ==
    IF Len(events) = 0 THEN <<>>
    ELSE LET prefix == Outputs(SubSeq(events, 1, Len(events) - 1))
             last == events[Len(events)]
         IN IF last[1] = "output" THEN Append(prefix, last) ELSE prefix

Init ==
    /\ issued = 0 /\ active = 0
    /\ history = <<>> /\ workerView = <<>> /\ pairChat = <<>>
    /\ mainListen = <<>> /\ status = <<>>
    /\ badAdmission = FALSE /\ badReplay = FALSE

Grant ==
    /\ active = 0 /\ issued < MaxGrant
    /\ issued' = issued + 1 /\ active' = issued + 1
    /\ UNCHANGED <<history, workerView, pairChat, mainListen, status,
                   badAdmission, badReplay>>

Revoke ==
    /\ active # 0 /\ active' = 0
    /\ UNCHANGED <<issued, history, workerView, pairChat, mainListen, status,
                   badAdmission, badReplay>>

Restart ==
    /\ active' = 0
    /\ UNCHANGED <<issued, history, workerView, pairChat, mainListen, status,
                   badAdmission, badReplay>>

Output(id, text) ==
    /\ id \in Grants /\ id <= issued /\ text \in Messages
    /\ Len(history) < MaxHistory
    /\ GuardCurrent => active = id
    /\ GuardBound => text \in Texts
    /\ LET event == <<"output", id, text>>
       IN /\ history' = Append(history, event)
          /\ workerView' = Append(workerView, event)
          /\ pairChat' = IF GuardPair THEN pairChat ELSE Append(pairChat, event)
          /\ mainListen' = IF GuardListen THEN mainListen
                           ELSE Append(mainListen, event)
          /\ status' = IF GuardStatus THEN status ELSE Append(status, event)
    /\ badAdmission' = (badAdmission \/ active # id \/ text \notin Texts)
    /\ UNCHANGED <<issued, active, badReplay>>

Lifecycle(id, text) ==
    /\ id \in Grants /\ id <= issued /\ text \in Texts
    /\ Len(history) < MaxHistory
    /\ LET event == <<"lifecycle", id, text>>
       IN /\ history' = Append(history, event)
          /\ workerView' = IF GuardProjection THEN workerView
                           ELSE Append(workerView, event)
          /\ pairChat' = Append(pairChat, event)
          /\ mainListen' = Append(mainListen, event)
          /\ status' = Append(status, event)
    /\ UNCHANGED <<issued, active, badAdmission, badReplay>>

Replay ==
    /\ workerView' = IF GuardOrder THEN Outputs(history) ELSE <<>>
    /\ active' = IF GuardReplay THEN active ELSE issued
    /\ badReplay' = (badReplay \/ (active = 0 /\ active' # 0))
    /\ UNCHANGED <<issued, history, pairChat, mainListen, status, badAdmission>>

Next == Grant \/ Revoke \/ Restart \/ Replay
        \/ (\E id \in Grants, text \in Messages: Output(id, text))
        \/ (\E id \in Grants, text \in Texts: Lifecycle(id, text))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ issued \in 0..MaxGrant /\ active \in 0..issued
    /\ history \in Seq(Events) /\ workerView \in Seq(Events)
    /\ pairChat \in Seq(Events) /\ mainListen \in Seq(Events)
    /\ status \in Seq(Events)
    /\ badAdmission \in BOOLEAN /\ badReplay \in BOOLEAN
OnlyLiveBounded == ~badAdmission
WorkerOutputOrder == workerView = Outputs(history)
NoRawMain == /\ Outputs(pairChat) = <<>> /\ Outputs(mainListen) = <<>>
             /\ Outputs(status) = <<>>
ReplayNoAuthority == ~badReplay
================================================================================
