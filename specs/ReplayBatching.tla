---- MODULE ReplayBatching -----------------------------------------------------
(***************************************************************************)
(* The workspace sends a replay to a companion's page in ordered batches  *)
(* (#118): consecutive small events share one message up to a size bound; *)
(* a session event, or one past the bound, goes alone; one too large to   *)
(* transfer is reported and skipped. One message per event was the old   *)
(* design, one cross-host round trip each.                                 *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS N, Bound, GuardAlone, GuardBound, GuardPacked

\* Event kinds and their sizes: "session" and "small" fit one message with
\* others; "large" fits only alone; "huge" does not fit at all.
Kinds == {"small", "session", "large", "huge"}
Weight(k) == CASE k = "small" -> 1 [] k = "session" -> 1
                [] k = "large" -> Bound + 1 [] k = "huge" -> Bound + 2

RECURSIVE SizeOf(_)
SizeOf(b) == IF b = <<>> THEN 0 ELSE Weight(Head(b)) + SizeOf(Tail(b))

\* An event that may share a message with its neighbors.
Shareable(k) == k = "small"

\* starts: where each sent batch began among the events.
VARIABLES events, next, sent, batches, starts, reported
vars == <<events, next, sent, batches, starts, reported>>

Init == /\ events \in [1..N -> Kinds]
        /\ next = 1 /\ sent = <<>> /\ batches = <<>> /\ starts = <<>>
        /\ reported = FALSE

\* Whether the event after batch b could have joined it.
CouldJoin(b, after) ==
    /\ after <= N
    /\ \A i \in 1..Len(b) : Shareable(b[i])
    /\ Shareable(events[after])
    /\ SizeOf(b) + Weight(events[after]) <= Bound

\* The batch of length k starting at `next`, and whether it may be sent.
Batch(k) == [i \in 1..k |-> events[next + i - 1]]
Allowed(k) ==
    LET b == Batch(k) IN
    /\ GuardAlone => (k = 1 \/ \A i \in 1..k : Shareable(b[i]))
    /\ GuardBound => (k = 1 \/ SizeOf(b) <= Bound)
    /\ GuardPacked => ~CouldJoin(b, next + k)

\* Sends one batch; a lone event too large to transfer is reported instead.
SendBatch(k) ==
    /\ next + k - 1 <= N
    /\ Allowed(k)
    /\ LET b == Batch(k) IN
         /\ IF k = 1 /\ b[1] = "huge"
              THEN /\ reported' = TRUE /\ sent' = sent
              ELSE /\ sent' = sent \o b /\ UNCHANGED reported
         /\ batches' = Append(batches, b)
    /\ starts' = Append(starts, next)
    /\ next' = next + k
    /\ UNCHANGED events

Next == \E k \in 1..N : SendBatch(k)
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK == /\ events \in [1..N -> Kinds] /\ next \in 1..(N + 1)
          /\ reported \in BOOLEAN

\* Every event sent so far arrived, in order, except one too large to send.
Ordered ==
    sent = SelectSeq([i \in 1..(next - 1) |-> events[i]],
                     LAMBDA k : k # "huge")
\* No message is over the bound unless it holds a single event.
Bounded == \A j \in 1..Len(batches) :
             Len(batches[j]) = 1 \/ SizeOf(batches[j]) <= Bound
\* A session event, which the companion acts on alone, travels alone.
SessionAlone == \A j \in 1..Len(batches) :
                  (\E i \in 1..Len(batches[j]) : batches[j][i] = "session")
                  => Len(batches[j]) = 1
\* Something happens, and with few messages: no batch could have taken the
\* event after it, so a run of small events is not sent one by one.
Packed == \A j \in 1..Len(batches) :
            ~CouldJoin(batches[j], starts[j] + Len(batches[j]))
\* Something must happen: the whole replay is eventually sent.
Done == <> (next = N + 1)
================================================================================
