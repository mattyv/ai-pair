---- MODULE WorkerSnapshots ----------------------------------------------------
EXTENDS Naturals, Sequences

\* The text atoms stand for cumulative snapshots, not literal text lengths or
\* a transport stream. An anonymous message always appends. A keyed message
\* replaces its worker's earlier snapshot without moving its insertion place.
\* A partial token suffix is withheld until final; complete tokens are
\* redacted. A final snapshot can restore an ordinary suffix. Actual DOM
\* rendering and the producer's prefix discipline are abstracted.
CONSTANTS MaxGrant, MaxItems, Texts, TooLong, Keys, NoKey, BadKey,
          GuardCurrent, GuardBounds, GuardCoalesce, GuardScope, GuardReplay,
          GuardPair, GuardListen, GuardVoice, GuardRedact
ASSUME /\ MaxGrant >= 2 /\ MaxItems >= 2
       /\ TooLong \notin Texts /\ NoKey \notin Keys /\ BadKey \notin Keys
       /\ NoKey # BadKey

VARIABLES issued, active, log, expected, view, pairChat, mainListen, voice,
          badAdmission
vars == <<issued, active, log, expected, view, pairChat, mainListen, voice,
          badAdmission>>
Grants == 1..MaxGrant
AllKeys == Keys \cup {NoKey, BadKey}
Messages == Texts \cup {TooLong, "withheld", "[redacted]"}
Safe(text, final) ==
    IF text = "token" THEN "[redacted]"
    ELSE IF text = "partial" /\ ~final THEN "withheld" ELSE text
Entries == Grants \X AllKeys \X Messages

Positions(entries, worker, key, scoped) ==
    {index \in 1..Len(entries):
        entries[index][2] = key /\ (scoped => entries[index][1] = worker)}

Put(entries, worker, key, text, coalesce, scoped) ==
    LET positions == Positions(entries, worker, key, scoped)
        event == <<worker, key, text>>
    IN IF key # NoKey /\ coalesce /\ positions # {}
       THEN [entries EXCEPT ![CHOOSE index \in positions: TRUE] = event]
       ELSE Append(entries, event)

Init ==
    /\ issued = 0 /\ active = 0
    /\ log = <<>> /\ expected = <<>> /\ view = <<>>
    /\ pairChat = <<>> /\ mainListen = <<>> /\ voice = <<>>
    /\ badAdmission = FALSE

Grant ==
    /\ active = 0 /\ issued < MaxGrant
    /\ issued' = issued + 1 /\ active' = issued + 1
    /\ UNCHANGED <<log, expected, view, pairChat, mainListen, voice,
                   badAdmission>>

Revoke ==
    /\ active # 0 /\ active' = 0
    /\ UNCHANGED <<issued, log, expected, view, pairChat, mainListen, voice,
                   badAdmission>>

Restart ==
    /\ active' = 0
    /\ UNCHANGED <<issued, log, expected, view, pairChat, mainListen, voice,
                   badAdmission>>

Snapshot(worker, key, text, final) ==
    /\ worker \in Grants /\ worker <= issued
    /\ key \in AllKeys /\ text \in Texts \cup {TooLong}
    /\ final \in BOOLEAN
    /\ GuardCurrent => active = worker
    /\ GuardBounds => (key # BadKey /\ text \in Texts /\
                        (final => key \in Keys))
    /\ Len(Put(log, worker, key, Safe(text, final), GuardCoalesce,
               GuardScope)) <= MaxItems
    /\ Len(Put(expected, worker, key, Safe(text, final), TRUE, TRUE))
       <= MaxItems
    /\ log' = Put(log, worker, key,
                   IF GuardRedact THEN Safe(text, final) ELSE text,
                   GuardCoalesce, GuardScope)
    /\ expected' = Put(expected, worker, key, Safe(text, final), TRUE, TRUE)
    /\ view' = log'
    /\ pairChat' = IF GuardPair THEN pairChat
                   ELSE Append(pairChat, <<worker, key, text>>)
    /\ mainListen' = IF GuardListen THEN mainListen
                     ELSE Append(mainListen, <<worker, key, text>>)
    /\ voice' = IF GuardVoice THEN voice
                ELSE Append(voice, <<worker, key, text>>)
    /\ badAdmission' = (badAdmission \/ active # worker \/ key = BadKey \/
                        text \notin Texts \/ (final /\ key \notin Keys))
    /\ UNCHANGED <<issued, active>>

Replay ==
    /\ view' = IF GuardReplay THEN log ELSE <<>>
    /\ UNCHANGED <<issued, active, log, expected, pairChat, mainListen, voice,
                   badAdmission>>

Next == Grant \/ Revoke \/ Restart \/ Replay
        \/ (\E worker \in Grants, key \in AllKeys,
            text \in Texts \cup {TooLong}, final \in BOOLEAN:
                Snapshot(worker, key, text, final))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ issued \in 0..MaxGrant /\ active \in 0..issued
    /\ log \in Seq(Entries) /\ expected \in Seq(Entries)
    /\ view \in Seq(Entries) /\ pairChat \in Seq(Entries)
    /\ mainListen \in Seq(Entries) /\ voice \in Seq(Entries)
    /\ badAdmission \in BOOLEAN
OnlyLiveBounded == ~badAdmission
CoalescedInOrder == log = expected
VisibleLatest == view = expected
NoRawMain == pairChat = <<>> /\ mainListen = <<>> /\ voice = <<>>
================================================================================
