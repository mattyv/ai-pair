---- MODULE SettingRoundTrip ---------------------------------------------------
(***************************************************************************)
(* A panel setting the programmer changes is written to VS Code's user    *)
(* settings, which a remote window reaches across its link (#119). Until  *)
(* the write lands, reads return the requested value, so a page that      *)
(* loads or an echoed change never shows the old one. A failed write is   *)
(* warned about and the page is shown the stored value. A reload waits    *)
(* for writes in flight.                                                   *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS Values, MaxSets, GuardPending, GuardWarn, GuardRevert, GuardFlush

\* stored: the value in VS Code's settings. queue: writes in flight, in
\* order. requested: the latest value asked for. shown: the page's value.
\* failedLast: the latest write failed. warned: the programmer was told.
\* lost: a reload dropped a write in flight.
VARIABLES stored, queue, requested, shown, sets, failedLast, warned, lost
vars == <<stored, queue, requested, shown, sets, failedLast, warned, lost>>

Init == /\ stored \in Values /\ queue = <<>> /\ requested = stored
        /\ shown = stored /\ sets = 0 /\ failedLast = FALSE
        /\ warned = FALSE /\ lost = FALSE

\* What a read returns: the requested value while a write is in flight.
\* Without GuardPending, the old design's read of the stored value.
Get == IF GuardPending /\ queue # <<>> THEN requested ELSE stored

\* The programmer picks a value; the page shows it at once.
Set(v) ==
    /\ sets < MaxSets
    /\ queue' = Append(queue, v) /\ requested' = v /\ shown' = v
    /\ sets' = sets + 1 /\ failedLast' = FALSE
    /\ UNCHANGED <<stored, warned, lost>>

\* The oldest write lands; VS Code's change event shows the page a read.
Land ==
    /\ queue # <<>>
    /\ stored' = Head(queue) /\ queue' = Tail(queue)
    /\ shown' = IF GuardPending /\ Tail(queue) # <<>> THEN requested
                ELSE Head(queue)
    /\ UNCHANGED <<requested, sets, failedLast, warned, lost>>

\* The oldest write fails. Only the latest one's failure matters: it is
\* warned about, and the page is shown the stored value again.
Fail ==
    /\ queue # <<>>
    /\ queue' = Tail(queue)
    /\ LET latest == Tail(queue) = <<>> IN
         /\ failedLast' = latest
         /\ warned' = (warned \/ (latest /\ GuardWarn))
         /\ shown' = IF latest /\ GuardRevert THEN stored ELSE shown
    /\ UNCHANGED <<stored, requested, sets, lost>>

\* A page loads, after a webview reload or a reconnect, and reads.
PageLoad ==
    /\ shown' = Get
    /\ UNCHANGED <<stored, queue, requested, sets, failedLast, warned, lost>>

\* The window reloads. It waits for writes in flight; without GuardFlush
\* it goes at once and drops them.
Reload ==
    /\ GuardFlush => queue = <<>>
    /\ lost' = (lost \/ queue # <<>>)
    /\ queue' = <<>> /\ shown' = stored
    /\ UNCHANGED <<stored, requested, sets, failedLast, warned>>

Next == \/ \E v \in Values : Set(v)
        \/ Land \/ Fail \/ PageLoad \/ Reload

Spec == Init /\ [][Next]_vars /\ WF_vars(Land \/ Fail)

TypeOK == /\ stored \in Values /\ requested \in Values /\ shown \in Values
          /\ queue \in Seq(Values) /\ sets \in 0..MaxSets
          /\ failedLast \in BOOLEAN /\ warned \in BOOLEAN
          /\ lost \in BOOLEAN

\* While a write is in flight, the page shows what was chosen.
ShowsChoice == queue # <<>> => shown = requested
\* Once writes settle, the page shows what is stored, unless the choice
\* failed and was not yet shown otherwise: then it was reverted.
SettledTruth == queue = <<>> => shown = stored
\* A failed choice is never silent.
NoSilentFailure == failedLast => warned
\* A reload never drops a write in flight.
NoLostWrite == ~lost
\* Something happens: every write in flight eventually settles.
WritesSettle == (queue # <<>>) ~> (queue = <<>>)
================================================================================
