---- MODULE CostReplay ---------------------------------------------------------
(******************************************************************************)
(* A workspace session identity lets the companion distinguish a page       *)
(* reopening the same session from one that missed a fresh session.          *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxSession

ASSUME AssumeBound == MaxSession \in Nat /\ MaxSession > 1

VARIABLES workspace, observed, page, ledger, owner, badSame

vars == <<workspace, observed, page, ledger, owner, badSame>>

TypeOK ==
    /\ workspace \in 1..MaxSession /\ observed \in 1..MaxSession
    /\ page \in BOOLEAN /\ ledger \in {"empty", "known", "partial"}
    /\ owner \in 1..MaxSession /\ badSame \in BOOLEAN

Init ==
    /\ workspace = 1 /\ observed = 1 /\ page = TRUE
    /\ ledger = "known" /\ owner = 1 /\ badSame = FALSE

Close ==
    /\ page /\ page' = FALSE
    /\ UNCHANGED <<workspace, observed, ledger, owner, badSame>>

\* A live fresh event resets the companion; a hidden page misses that event.
Fresh ==
    /\ workspace < MaxSession /\ workspace' = workspace + 1
    /\ observed' = IF page THEN workspace + 1 ELSE observed
    /\ ledger' = IF page THEN "empty" ELSE ledger
    /\ owner' = IF page THEN workspace + 1 ELSE owner
    /\ UNCHANGED <<page, badSame>>

\* Reopening preserves the same ledger or replaces an unseen one as partial.
Reopen ==
    /\ ~page /\ page' = TRUE
    /\ observed' = workspace
    /\ ledger' = IF observed = workspace THEN ledger ELSE "partial"
    /\ owner' = IF observed = workspace THEN owner ELSE workspace
    /\ badSame' = (badSame \/ (observed = workspace /\ ledger' # ledger))
    /\ UNCHANGED workspace

Confirm ==
    /\ page /\ observed = workspace
    /\ ledger' = "known" /\ owner' = workspace
    /\ UNCHANGED <<workspace, observed, page, badSame>>

Next == Close \/ Fresh \/ Reopen \/ Confirm
Spec == Init /\ [][Next]_vars /\ WF_vars(Reopen)

\* A visible confirmed subtotal cannot belong to an earlier session.
CurrentLedger == (page /\ ledger = "known") => owner = workspace

\* Reopening the same session does not discard its subtotal.
SamePreserved == ~badSame

\* A closed page eventually reopens under the stated fairness assumption.
ReopenProgress == [] (~page => <> page)

================================================================================
