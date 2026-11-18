---- MODULE PanelPlacement -----------------------------------------------------
(***************************************************************************
 * A prepared companion does not own a view until an irrevocable commit.  *
 * Timeout before commit may fall back; timeout after commit may not.      *
 * A companion the window does not know of yet is looked for until a      *
 * deadline; only a companion never reached is reported missing (#115).    *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardPrepare, GuardFallback, GuardAck, GuardDiscovery, GuardReached

\* known: the companion is visible to the window's command routing.
\* reached: an activation attempt found the companion, so it is installed.
\* expired: the discovery deadline has passed.
VARIABLES phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback, acked, known, reached, expired
vars == <<phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback, acked, known, reached, expired>>
other == <<known, reached, expired>>

Init ==
    /\ phase = "idle" /\ tokenValid = FALSE /\ committed = FALSE
    /\ mainRegistered = FALSE /\ companionRegistered = FALSE
    /\ lateSeen = FALSE /\ badEarly = FALSE /\ badFallback = FALSE
    /\ acked = FALSE
    /\ known \in BOOLEAN /\ reached = FALSE /\ expired = FALSE

\* The companion's extension host registers it, at any time: in a remote
\* window it may come after the workspace host has started.
Appear ==
    /\ ~known /\ known' = TRUE
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered,
                   companionRegistered, lateSeen, badEarly, badFallback,
                   acked, reached, expired>>

Activate ==
    /\ phase = "idle" /\ phase' = "activating"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>> /\ UNCHANGED other

\* An activation attempt that finds the companion; one that does not is
\* retried, which changes no state.
Prepare ==
    /\ phase = "activating" /\ known /\ phase' = "preparing"
    /\ tokenValid' = TRUE /\ reached' = TRUE
    /\ UNCHANGED <<committed, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked, known, expired>>

Prepared ==
    /\ phase = "preparing" /\ tokenValid /\ phase' = "prepared"
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, lateSeen,
                   badFallback, acked>> /\ UNCHANGED other

Commit ==
    /\ phase = "prepared" /\ tokenValid /\ phase' = "committed"
    /\ committed' = TRUE
    /\ UNCHANGED <<tokenValid, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked>> /\ UNCHANGED other

\* The discovery deadline passes with the companion never found: the window
\* reports it missing and keeps its own panel. Without GuardReached, the old
\* design also gives up this way on a companion that was reached.
ExpireBeforeCommit ==
    /\ phase \in IF GuardReached THEN {"activating"}
                 ELSE {"activating", "preparing", "prepared"}
    /\ ~committed /\ (GuardReached => ~known)
    /\ phase' = "fallback" /\ tokenValid' = FALSE /\ mainRegistered' = TRUE
    /\ expired' = TRUE
    /\ UNCHANGED <<committed, companionRegistered, lateSeen, badEarly,
                   badFallback, acked, known, reached>>

\* The old design: the first attempt that does not find the companion
\* reports it missing, before the deadline (#115).
GiveUpEarly ==
    /\ ~GuardDiscovery /\ phase = "activating" /\ ~known
    /\ phase' = "fallback" /\ tokenValid' = FALSE /\ mainRegistered' = TRUE
    /\ UNCHANGED <<committed, companionRegistered, lateSeen, badEarly,
                   badFallback, acked, known, reached, expired>>

\* An installed companion that did not prepare selects no owner. This includes
\* a version 2 companion paired with the version 3 workspace protocol.
\* So does a found companion that does not start, or answers late.
RejectInstalled ==
    /\ phase \in {"activating", "preparing", "prepared"} /\ ~committed /\ known
    /\ phase' = "incompatible" /\ tokenValid' = FALSE
    /\ UNCHANGED <<committed, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked>> /\ UNCHANGED other

LatePrepared ==
    /\ phase \in {"fallback", "incompatible"} /\ reached /\ ~lateSeen
    /\ lateSeen' = TRUE
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered,
                   badFallback, acked>> /\ UNCHANGED other

Register ==
    /\ committed /\ ~companionRegistered /\ companionRegistered' = TRUE
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered, lateSeen,
                   badEarly, badFallback, acked>> /\ UNCHANGED other

Acknowledged ==
    /\ phase = "committed" /\ companionRegistered /\ phase' = "attached"
    /\ acked' = TRUE
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback>> /\ UNCHANGED other

StartSession ==
    /\ phase \in IF GuardAck THEN {"attached"} ELSE {"attached", "committed"}
    /\ phase' = "active"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>> /\ UNCHANGED other

Close ==
    /\ phase \in {"committed", "attached"} /\ phase' = "closed"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>> /\ UNCHANGED other

TimeoutAfterCommit ==
    /\ phase = "committed" /\ phase' = "unavailable"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>> /\ UNCHANGED other

UnsafeFallback ==
    /\ ~GuardFallback /\ committed /\ ~mainRegistered
    /\ phase' = "fallback" /\ mainRegistered' = TRUE /\ badFallback' = TRUE
    /\ UNCHANGED <<tokenValid, committed, companionRegistered, lateSeen,
                   badEarly, acked>> /\ UNCHANGED other

Next == Appear \/ Activate \/ Prepare \/ Prepared \/ Commit
        \/ ExpireBeforeCommit
        \/ GiveUpEarly \/ RejectInstalled \/ LatePrepared
        \/ Register \/ Acknowledged \/ StartSession \/ Close
        \/ TimeoutAfterCommit \/ UnsafeFallback
Spec == Init /\ [][Next]_vars /\ WF_vars(TimeoutAfterCommit) /\
        WF_vars(ExpireBeforeCommit) /\ WF_vars(RejectInstalled)
TypeOK ==
    /\ phase \in {"idle", "activating", "preparing", "prepared",
                  "committed", "attached", "fallback",
                  "unavailable", "incompatible", "active", "closed"}
    /\ tokenValid \in BOOLEAN /\ committed \in BOOLEAN
    /\ mainRegistered \in BOOLEAN /\ companionRegistered \in BOOLEAN
    /\ lateSeen \in BOOLEAN /\ badEarly \in BOOLEAN /\ badFallback \in BOOLEAN
    /\ acked \in BOOLEAN
    /\ known \in BOOLEAN /\ reached \in BOOLEAN /\ expired \in BOOLEAN
NoSessionBeforeAck == phase = "active" => acked
NoSessionAfterClose == [][phase = "closed" => phase' # "active"]_vars
NoEarlyRegistration == ~badEarly
NoFallbackAfterCommit == ~badFallback
NoDuplicateRegistration == ~(mainRegistered /\ companionRegistered)
CanPrepare == phase = "idle" => ENABLED Activate
CanCommit == phase = "prepared" => ENABLED Commit
CanRegister == (committed /\ ~companionRegistered) => ENABLED Register
CanFallback == phase \in {"activating", "preparing", "prepared"} =>
    ENABLED ExpireBeforeCommit \/ ENABLED RejectInstalled
\* Missing means never reached, and only once the deadline has passed (#115).
NoMissingOnceReached == phase = "fallback" => ~reached
NoEarlyMissing == phase = "fallback" => expired
PreparationSettles == (phase \in {"activating", "preparing", "prepared"}) ~>
    (phase \in {"committed", "fallback", "attached",
                "unavailable", "incompatible", "closed", "active"})
CommittedSettles == (phase = "committed") ~>
                    (phase \in {"attached", "unavailable", "closed", "active"})
================================================================================
