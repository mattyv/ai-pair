---- MODULE SpeechSetup --------------------------------------------------------
(***************************************************************************)
(* One setup transaction. Target and backup abstract directory renames.    *)
(* Cancellation wins only before Dispatch, the commit linearization     *)
(* boundary: once rename is dispatched, its atomic outcome may succeed.  *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    Files, GuardCommit

ASSUME Files \in Nat \ {0}

VARIABLES phase, count, bad, verified, target, backup, hadPrevious,
          newInstalled, cancelledBeforeDispatch
vars == <<phase, count, bad, verified, target, backup, hadPrevious,
          newInstalled, cancelledBeforeDispatch>>

TypeOK ==
    /\ phase \in {"idle", "download", "verified", "backedUp", "commit",
                   "rollback", "done", "failed", "cancelled"}
    /\ count \in 0..Files
    /\ bad \in BOOLEAN
    /\ verified \in BOOLEAN
    /\ target \in BOOLEAN
    /\ backup \in BOOLEAN
    /\ hadPrevious \in BOOLEAN
    /\ newInstalled \in BOOLEAN
    /\ cancelledBeforeDispatch \in BOOLEAN

Init ==
    /\ phase = "idle" /\ count = 0 /\ bad = FALSE /\ verified = FALSE
    /\ hadPrevious \in BOOLEAN /\ target = hadPrevious /\ backup = FALSE
    /\ newInstalled = FALSE /\ cancelledBeforeDispatch = FALSE

Start ==
    /\ phase = "idle" /\ phase' = "download"
    /\ UNCHANGED <<count, bad, verified, target, backup, hadPrevious,
                   newInstalled, cancelledBeforeDispatch>>

Download ==
    /\ phase = "download" /\ count < Files
    /\ count' = count + 1 /\ bad' \in {bad, TRUE}
    /\ UNCHANGED <<phase, verified, target, backup, hadPrevious,
                   newInstalled, cancelledBeforeDispatch>>

Verify ==
    /\ phase = "download" /\ count = Files
    /\ phase' = IF bad THEN "failed" ELSE "verified"
    /\ verified' = ~bad
    /\ UNCHANGED <<count, bad, target, backup, hadPrevious,
                   newInstalled, cancelledBeforeDispatch>>

Backup ==
    /\ phase = "verified"
    /\ phase' = "backedUp" /\ backup' = target /\ target' = FALSE
    /\ UNCHANGED <<count, bad, verified, hadPrevious, newInstalled,
                   cancelledBeforeDispatch>>

Dispatch ==
    /\ phase = "backedUp" \/ (~GuardCommit /\ phase = "download")
    /\ phase' = "commit"
    /\ UNCHANGED <<count, bad, verified, target, backup, hadPrevious,
                   newInstalled, cancelledBeforeDispatch>>

Commit ==
    /\ phase = "commit"
    /\ phase' \in {"done", "rollback"}
    /\ target' = (phase' = "done")
    /\ newInstalled' = (phase' = "done")
    /\ UNCHANGED <<count, bad, verified, backup, hadPrevious,
                   cancelledBeforeDispatch>>

Cancel ==
    /\ phase \in {"download", "verified", "backedUp"}
    /\ phase' = IF phase = "backedUp" THEN "rollback" ELSE "cancelled"
    /\ cancelledBeforeDispatch' = TRUE
    /\ UNCHANGED <<count, bad, verified, target, backup, hadPrevious,
                   newInstalled>>

Rollback ==
    /\ phase = "rollback"
    /\ phase' = IF cancelledBeforeDispatch THEN "cancelled" ELSE "failed"
    /\ IF backup THEN
          \/ /\ target' = TRUE /\ backup' = FALSE
          \/ /\ target' = FALSE /\ backup' = TRUE
       ELSE /\ target' = target /\ backup' = backup
    /\ UNCHANGED <<count, bad, verified, hadPrevious, newInstalled,
                   cancelledBeforeDispatch>>

Next == Start \/ Download \/ Verify \/ Backup \/ Dispatch \/ Commit \/
        Cancel \/ Rollback
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Download) /\
        WF_vars(Verify) /\ WF_vars(Backup) /\ WF_vars(Dispatch) /\
        WF_vars(Commit) /\ WF_vars(Rollback)

InstalledOnlyIfVerified == newInstalled => verified
NoLostPrevious == hadPrevious => (target \/ backup)
NoBadInstall == newInstalled => ~bad
CancelledDoesNotInstall == cancelledBeforeDispatch => ~newInstalled
SetupProgress == (phase \in {"download", "verified", "backedUp", "commit",
                            "rollback"}) ~>
                 (phase \in {"done", "failed", "cancelled"})
================================================================================
