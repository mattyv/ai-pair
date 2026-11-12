---- MODULE CommandApproval ----------------------------------------------------
(******************************************************************************)
(* One pairing session owns command approvals. A decision may allow one run,  *)
(* remember an exact command, or allow all commands until a new session.      *)
(* Reconnection and window reload preserve the approval; a fresh session      *)
(* clears it. A stale decision cannot grant a later session permission.       *)
(******************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxSession, Commands

ASSUME AssumeBounds ==
    /\ MaxSession \in Nat
    /\ Commands # {}
    /\ "none" \notin Commands

VARIABLES
    session, phase, allowed, allowAll, allGrantedIn, confirmRequired,
    pending, pendingIn, lastMode, lastCommand

vars == <<session, phase, allowed, allowAll, allGrantedIn, confirmRequired,
          pending, pendingIn, lastMode, lastCommand>>

TypeOK ==
    /\ session \in 0..MaxSession
    /\ phase \in {"live", "suspended", "ended"}
    /\ allowed \subseteq Commands
    /\ allowAll \in BOOLEAN
    /\ confirmRequired \in BOOLEAN
    /\ allGrantedIn \in 0..(MaxSession + 1)
    /\ pending \in Commands \cup {"none"}
    /\ pendingIn \in 0..(MaxSession + 1)
    /\ lastMode \in {"none", "once", "command", "all", "global"}
    /\ lastCommand \in Commands \cup {"none"}

Init ==
    /\ session = 0 /\ phase = "live" /\ allowed = {}
    /\ allowAll = FALSE /\ allGrantedIn = MaxSession + 1
    /\ confirmRequired = TRUE
    /\ pending = "none" /\ pendingIn = MaxSession + 1
    /\ lastMode = "none" /\ lastCommand = "none"

\* A command needs approval unless this session already allowed it.
Ask(command) ==
    /\ phase = "live" /\ pending = "none"
    /\ confirmRequired /\ ~allowAll /\ command \notin allowed
    /\ pending' = command /\ pendingIn' = session
    /\ UNCHANGED <<session, phase, allowed, allowAll, allGrantedIn,
                   confirmRequired, lastMode, lastCommand>>

\* The player executes a command already allowed by this session.
RunAllowed(command) ==
    /\ phase = "live" /\ pending = "none"
    /\ (~confirmRequired \/ allowAll \/ command \in allowed)
    /\ lastMode' = IF ~confirmRequired THEN "global"
                   ELSE IF allowAll THEN "all" ELSE "command"
    /\ lastCommand' = command
    /\ UNCHANGED <<session, phase, allowed, allowAll, allGrantedIn,
                   confirmRequired, pending, pendingIn>>

\* Only the current confirmation may grant approval.
Decide(scope) ==
    /\ phase = "live" /\ pending # "none" /\ pendingIn = session
    /\ scope \in {"once", "command", "all", "decline"}
    /\ allowed' = IF scope = "command" THEN allowed \cup {pending} ELSE allowed
    /\ allowAll' = (allowAll \/ scope = "all")
    /\ allGrantedIn' = IF scope = "all" THEN session ELSE allGrantedIn
    /\ lastMode' = IF scope = "decline" THEN lastMode ELSE "once"
    /\ lastCommand' = IF scope = "decline" THEN lastCommand ELSE pending
    /\ pending' = "none" /\ pendingIn' = MaxSession + 1
    /\ UNCHANGED <<session, phase, confirmRequired>>

\* Suspending or reloading interrupts a pending prompt but keeps approvals.
Suspend ==
    /\ phase = "live" /\ phase' = "suspended"
    /\ pending' = "none" /\ pendingIn' = MaxSession + 1
    /\ UNCHANGED <<session, allowed, allowAll, allGrantedIn, confirmRequired,
                   lastMode, lastCommand>>

Resume ==
    /\ phase = "suspended" /\ phase' = "live"
    /\ UNCHANGED <<session, allowed, allowAll, allGrantedIn, confirmRequired,
                   pending, pendingIn, lastMode, lastCommand>>

End ==
    /\ phase # "ended" /\ phase' = "ended"
    /\ pending' = "none" /\ pendingIn' = MaxSession + 1
    /\ UNCHANGED <<session, allowed, allowAll, allGrantedIn, confirmRequired,
                   lastMode, lastCommand>>

\* A different session starts with no inherited approvals.
Fresh ==
    /\ phase \in {"ended", "suspended"} /\ session < MaxSession
    /\ session' = session + 1 /\ phase' = "live"
    /\ allowed' = {} /\ allowAll' = FALSE /\ allGrantedIn' = MaxSession + 1
    /\ pending' = "none" /\ pendingIn' = MaxSession + 1
    /\ lastMode' = "none" /\ lastCommand' = "none"
    /\ UNCHANGED confirmRequired

\* Revocation removes every remembered grant from the current session.
Revoke ==
    /\ phase \in {"live", "suspended"}
    /\ ~confirmRequired \/ allowAll \/ allowed # {}
    /\ allowed' = {} /\ allowAll' = FALSE /\ confirmRequired' = TRUE
    /\ allGrantedIn' = MaxSession + 1
    /\ lastMode' = "none" /\ lastCommand' = "none"
    /\ UNCHANGED <<session, phase, pending, pendingIn>>

\* The user may disable confirmation in settings.
DisableConfirmation ==
    /\ confirmRequired /\ confirmRequired' = FALSE
    /\ UNCHANGED <<session, phase, allowed, allowAll, allGrantedIn,
                   pending, pendingIn, lastMode, lastCommand>>

AnyAsk == \E command \in Commands : Ask(command)
AnyRun == \E command \in Commands : RunAllowed(command)
AnyDecision ==
    \E scope \in {"once", "command", "all", "decline"} : Decide(scope)
Next == AnyAsk \/ AnyRun \/ AnyDecision \/ Revoke \/ DisableConfirmation
        \/ Suspend \/ Resume \/ End \/ Fresh
Fairness == WF_vars(AnyDecision)
Spec == Init /\ [][Next]_vars /\ Fairness

\* An all-command grant belongs to this session.
CurrentAllGrant == allowAll => allGrantedIn = session

\* Automatic runs have a matching current session permission.
RunHasApproval ==
    /\ (lastMode = "global") => ~confirmRequired
    /\ (lastMode = "all") => (allowAll /\ allGrantedIn = session)
    /\ (lastMode = "command") => (lastCommand \in allowed)

\* The reset transition removes both session grants and the global bypass.
ResetEnforces ==
    [][Revoke => (confirmRequired' /\ ~allowAll' /\ allowed' = {})]_vars

\* A pending prompt eventually resolves, or the session is interrupted.
PromptProgress == [](pending # "none" => <> (pending = "none"))

================================================================================
