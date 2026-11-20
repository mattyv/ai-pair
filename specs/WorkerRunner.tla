---- MODULE WorkerRunner -------------------------------------------------------
EXTENDS Naturals

\* One grant and one native app-server child. A preflight acknowledgement is
\* separate from physical process retirement. Child output is abstracted to a
\* Boolean, not its content or delivery; terminal errors are abstracted to a
\* blocker. Closing is an external event and may fail before a later retry.
CONSTANTS GuardPreflight, GuardRetired, GuardHold
VARIABLES grantLive, ownerHeld, preflight, child, turnDone, output, done,
          blocker, retirementFailed, badLaunch, badRelease
vars == <<grantLive, ownerHeld, preflight, child, turnDone, output, done,
          blocker, retirementFailed, badLaunch, badRelease>>

Init ==
    /\ grantLive = TRUE /\ ownerHeld = TRUE
    /\ preflight = "pending" /\ child = "none"
    /\ turnDone = FALSE /\ output = FALSE /\ done = FALSE
    /\ blocker = FALSE /\ retirementFailed = FALSE
    /\ badLaunch = FALSE /\ badRelease = FALSE

Accept ==
    /\ preflight = "pending" /\ grantLive
    /\ preflight' = "accepted"
    /\ UNCHANGED <<grantLive, ownerHeld, child, turnDone, output, done,
                   blocker, retirementFailed, badLaunch, badRelease>>

Reject ==
    /\ preflight = "pending" /\ preflight' = "rejected"
    /\ UNCHANGED <<grantLive, ownerHeld, child, turnDone, output, done,
                   blocker, retirementFailed, badLaunch, badRelease>>

Revoke ==
    /\ grantLive /\ grantLive' = FALSE
    /\ UNCHANGED <<ownerHeld, preflight, child, turnDone, output, done,
                   blocker, retirementFailed, badLaunch, badRelease>>

Launch ==
    /\ child = "none" /\ ~done
    /\ GuardPreflight => (preflight = "accepted" /\ grantLive /\ ownerHeld)
    /\ child' = "live"
    /\ badLaunch' = (badLaunch \/ preflight # "accepted" \/ ~grantLive \/
                      ~ownerHeld)
    /\ UNCHANGED <<grantLive, ownerHeld, preflight, turnDone, output, done,
                   blocker, retirementFailed, badRelease>>

Output ==
    /\ child = "live" /\ ~turnDone /\ ~output
    /\ output' = TRUE
    /\ UNCHANGED <<grantLive, ownerHeld, preflight, child, turnDone, done,
                   blocker, retirementFailed, badLaunch, badRelease>>

Complete ==
    /\ child = "live" /\ ~turnDone /\ turnDone' = TRUE
    /\ UNCHANGED <<grantLive, ownerHeld, preflight, child, output, done,
                   blocker, retirementFailed, badLaunch, badRelease>>

CloseFailed ==
    /\ child = "live" /\ turnDone /\ ~retirementFailed
    /\ blocker' = TRUE /\ retirementFailed' = TRUE
    /\ ownerHeld' = IF GuardHold THEN ownerHeld ELSE FALSE
    /\ UNCHANGED <<grantLive, preflight, child, turnDone, output, done,
                   badLaunch, badRelease>>

Close ==
    /\ child = "live" /\ turnDone /\ child' = "closed"
    /\ retirementFailed' = FALSE
    /\ UNCHANGED <<grantLive, ownerHeld, preflight, turnDone, output, done,
                   blocker, badLaunch, badRelease>>

WorkerDone ==
    /\ ~done /\ grantLive /\ ownerHeld /\ turnDone
    /\ GuardRetired => child = "closed"
    /\ done' = TRUE /\ ownerHeld' = FALSE
    /\ badRelease' = (badRelease \/ child # "closed")
    /\ UNCHANGED <<grantLive, preflight, child, turnDone, output,
                   blocker, retirementFailed, badLaunch>>

Next == Accept \/ Reject \/ Revoke \/ Launch \/ Output \/ Complete
        \/ CloseFailed \/ Close \/ WorkerDone
Spec == Init /\ [][Next]_vars /\ WF_vars(Close)

TypeOK ==
    /\ grantLive \in BOOLEAN /\ ownerHeld \in BOOLEAN
    /\ preflight \in {"pending", "accepted", "rejected"}
    /\ child \in {"none", "live", "closed"}
    /\ turnDone \in BOOLEAN /\ output \in BOOLEAN /\ done \in BOOLEAN
    /\ blocker \in BOOLEAN /\ retirementFailed \in BOOLEAN
    /\ badLaunch \in BOOLEAN /\ badRelease \in BOOLEAN
LaunchAcknowledged == ~badLaunch
ReleaseAfterClose == ~badRelease
FailedRetainsOwner == retirementFailed => (blocker /\ ownerHeld /\ ~done)
OutputNeedsChild == output => child # "none"
RetirementProgress == (child = "live" /\ turnDone) ~> (child = "closed")
================================================================================
