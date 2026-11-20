---- MODULE WorkerNotice -------------------------------------------------------
\* One current worker has a bounded, latest-value notice slot. Questions and
\* blockers wake an open listen; routine progress is panel-only. Replacement
\* drops the slot and rejects stale notices. Earlier notices may be coalesced.
EXTENDS Naturals

CONSTANTS AcceptStale, WakeNotices, ClearNotice
ASSUME /\ AcceptStale \in BOOLEAN
       /\ WakeNotices \in BOOLEAN
       /\ ClearNotice \in BOOLEAN

Generations == {1, 2}
Kinds == {"question", "blocked"}
None == "none"

VARIABLES generation, notice, noticeOwner, listen, delivered, progress
vars == <<generation, notice, noticeOwner, listen, delivered, progress>>

Init == /\ generation = 1
        /\ notice = None
        /\ noticeOwner = 0
        /\ listen = FALSE
        /\ delivered = 0
        /\ progress = FALSE

\* The latest question or blocker replaces any earlier undelivered notice.
Post(g, kind) == /\ g = generation \/ AcceptStale
                 /\ notice' = kind
                 /\ noticeOwner' = g
                 /\ UNCHANGED <<generation, listen, delivered, progress>>

Progress == /\ ~progress
            /\ progress' = TRUE
            /\ UNCHANGED <<generation, notice, noticeOwner, listen, delivered>>

Listen == /\ ~listen
          /\ listen' = TRUE
          /\ UNCHANGED <<generation, notice, noticeOwner, delivered, progress>>

Deliver == /\ WakeNotices /\ listen /\ notice # None
           /\ delivered < 2
           /\ delivered' = delivered + 1
           /\ notice' = IF ClearNotice THEN None ELSE notice
           /\ noticeOwner' = IF ClearNotice THEN 0 ELSE noticeOwner
           /\ listen' = FALSE
           /\ UNCHANGED <<generation, progress>>

Replace == /\ generation = 1
           /\ generation' = 2
           /\ notice' = None
           /\ noticeOwner' = 0
           /\ listen' = FALSE
           /\ UNCHANGED <<delivered, progress>>

Next == \/ \E g \in Generations, kind \in Kinds : Post(g, kind)
        \/ Progress \/ Listen \/ Deliver \/ Replace
Spec == Init /\ [][Next]_vars /\ WF_vars(Deliver)

TypeOK == /\ generation \in Generations /\ notice \in Kinds \cup {None}
          /\ noticeOwner \in Generations \cup {0}
          /\ listen \in BOOLEAN /\ delivered \in 0..2 /\ progress \in BOOLEAN
CurrentNotice == notice # None => noticeOwner = generation
Cleared == [][Deliver => notice' = None]_vars
Wake == (listen /\ notice # None /\ delivered < 2) ~>
          (~listen \/ notice = None)
\* A replacement is the only modeled reason to clear an undelivered notice.
NoProgressWake == [][Progress => listen' = listen]_vars
================================================================================
