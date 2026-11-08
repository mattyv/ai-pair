---- MODULE OutputAdmission ----------------------------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS
    GuardAdmission, GuardPlay

VARIABLES epoch, available, issued, pending, captured, owner, reserved,
          badAdmission, badPlay
vars == <<epoch, available, issued, pending, captured, owner, reserved,
          badAdmission, badPlay>>

Init ==
    /\ epoch = 0 /\ available = TRUE /\ issued = 0 /\ pending = {}
    /\ captured = [i \in 1..2 |-> 0] /\ owner = 0 /\ reserved = 0
    /\ badAdmission = FALSE /\ badPlay = FALSE

Check ==
    /\ issued < 2 /\ issued' = issued + 1 /\ owner' = issued + 1
    /\ pending' = pending \cup {issued + 1}
    /\ captured' = [captured EXCEPT ![issued + 1] = epoch]
    /\ reserved' = 0
    /\ UNCHANGED <<epoch, available, badAdmission, badPlay>>

Complete(i) ==
    /\ i \in pending
    /\ (~GuardAdmission \/ (i = owner /\ captured[i] = epoch /\ available))
    /\ pending' = pending \ {i} /\ reserved' = i
    /\ badAdmission' = (badAdmission \/ i # owner \/ captured[i] # epoch
                        \/ ~available)
    /\ UNCHANGED <<epoch, available, issued, captured, owner, badPlay>>

Timeout(i) ==
    /\ i \in pending /\ pending' = pending \ {i}
    /\ UNCHANGED <<epoch, available, issued, captured, owner, reserved,
                   badAdmission, badPlay>>

Play(i) ==
    /\ reserved # 0 /\ i \in 1..2 /\ (~GuardPlay \/ i = reserved)
    /\ badPlay' = (badPlay \/ i # reserved)
    /\ reserved' = 0
    /\ UNCHANGED <<epoch, available, issued, pending, captured, owner,
                   badAdmission>>

Change ==
    /\ epoch < 2 /\ epoch' = epoch + 1 /\ owner' = 0 /\ reserved' = 0
    /\ UNCHANGED <<available, issued, pending, captured, badAdmission, badPlay>>

Lose == /\ available /\ available' = FALSE
        /\ UNCHANGED <<epoch, issued, pending, captured, owner, reserved,
                       badAdmission, badPlay>>
Restore == /\ ~available /\ available' = TRUE
           /\ UNCHANGED <<epoch, issued, pending, captured, owner, reserved,
                          badAdmission, badPlay>>

Next == Check \/ (\E i \in 1..2: Complete(i) \/ Timeout(i) \/ Play(i))
        \/ Change \/ Lose \/ Restore
Spec == Init /\ [][Next]_vars /\ (\A i \in 1..2: WF_vars(Timeout(i)))
TypeOK == /\ epoch \in 0..2 /\ available \in BOOLEAN /\ issued \in 0..2
          /\ pending \subseteq 1..2 /\ captured \in [1..2 -> 0..2]
          /\ owner \in 0..2 /\ reserved \in 0..2
          /\ badAdmission \in BOOLEAN /\ badPlay \in BOOLEAN
NoUnsafeDispatch == ~badAdmission
NoStalePlay == ~badPlay
CanCheck == issued < 2 => ENABLED Check
CanComplete == \A i \in 1..2:
    (i \in pending /\ i = owner /\ captured[i] = epoch /\ available)
    => ENABLED Complete(i)
Settles == \A i \in 1..2: (i \in pending) ~> (i \notin pending)
================================================================================
