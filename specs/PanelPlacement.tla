---- MODULE PanelPlacement -----------------------------------------------------
(***************************************************************************
 * A prepared companion does not own a view until an irrevocable commit.  *
 * Timeout before commit may fall back; timeout after commit may not.      *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardPrepare, GuardFallback, GuardAck

VARIABLES phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback, acked
vars == <<phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback, acked>>

Init ==
    /\ phase = "idle" /\ tokenValid = FALSE /\ committed = FALSE
    /\ mainRegistered = FALSE /\ companionRegistered = FALSE
    /\ lateSeen = FALSE /\ badEarly = FALSE /\ badFallback = FALSE
    /\ acked = FALSE

Activate ==
    /\ phase = "idle" /\ phase' = "activating"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>>

Prepare ==
    /\ phase = "activating" /\ phase' = "preparing" /\ tokenValid' = TRUE
    /\ UNCHANGED <<committed, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked>>

Prepared ==
    /\ phase = "preparing" /\ tokenValid /\ phase' = "prepared"
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, lateSeen,
                   badFallback, acked>>

Commit ==
    /\ phase = "prepared" /\ tokenValid /\ phase' = "committed"
    /\ committed' = TRUE
    /\ UNCHANGED <<tokenValid, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked>>

ExpireBeforeCommit ==
    /\ phase \in {"activating", "preparing", "prepared"} /\ ~committed
    /\ phase' = "fallback" /\ tokenValid' = FALSE /\ mainRegistered' = TRUE
    /\ UNCHANGED <<committed, companionRegistered, lateSeen, badEarly,
                   badFallback, acked>>

\* An installed companion that did not prepare selects no owner.
RejectInstalled ==
    /\ phase \in {"activating", "preparing", "prepared"} /\ ~committed
    /\ phase' = "incompatible" /\ tokenValid' = FALSE
    /\ UNCHANGED <<committed, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback, acked>>

LatePrepared ==
    /\ phase = "fallback" /\ ~lateSeen /\ lateSeen' = TRUE
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered,
                   badFallback, acked>>

Register ==
    /\ committed /\ ~companionRegistered /\ companionRegistered' = TRUE
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered, lateSeen,
                   badEarly, badFallback, acked>>

Acknowledged ==
    /\ phase = "committed" /\ companionRegistered /\ phase' = "attached"
    /\ acked' = TRUE
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback>>

StartSession ==
    /\ phase \in IF GuardAck THEN {"attached"} ELSE {"attached", "committed"}
    /\ phase' = "active"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>>

Close ==
    /\ phase \in {"committed", "attached"} /\ phase' = "closed"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>>

TimeoutAfterCommit ==
    /\ phase = "committed" /\ phase' = "unavailable"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback, acked>>

UnsafeFallback ==
    /\ ~GuardFallback /\ committed /\ ~mainRegistered
    /\ phase' = "fallback" /\ mainRegistered' = TRUE /\ badFallback' = TRUE
    /\ UNCHANGED <<tokenValid, committed, companionRegistered, lateSeen,
                   badEarly, acked>>

Next == Activate \/ Prepare \/ Prepared \/ Commit \/ ExpireBeforeCommit
        \/ RejectInstalled \/ LatePrepared
        \/ Register \/ Acknowledged \/ StartSession \/ Close
        \/ TimeoutAfterCommit \/ UnsafeFallback
Spec == Init /\ [][Next]_vars /\ WF_vars(TimeoutAfterCommit) /\
        WF_vars(ExpireBeforeCommit)
TypeOK ==
    /\ phase \in {"idle", "activating", "preparing", "prepared",
                  "committed", "attached", "fallback",
                  "unavailable", "incompatible", "active", "closed"}
    /\ tokenValid \in BOOLEAN /\ committed \in BOOLEAN
    /\ mainRegistered \in BOOLEAN /\ companionRegistered \in BOOLEAN
    /\ lateSeen \in BOOLEAN /\ badEarly \in BOOLEAN /\ badFallback \in BOOLEAN
    /\ acked \in BOOLEAN
NoSessionBeforeAck == phase = "active" => acked
NoSessionAfterClose == [][phase = "closed" => phase' # "active"]_vars
NoEarlyRegistration == ~badEarly
NoFallbackAfterCommit == ~badFallback
NoDuplicateRegistration == ~(mainRegistered /\ companionRegistered)
CanPrepare == phase = "idle" => ENABLED Activate
CanCommit == phase = "prepared" => ENABLED Commit
CanRegister == (committed /\ ~companionRegistered) => ENABLED Register
CanFallback == phase \in {"activating", "preparing", "prepared"} =>
    ENABLED ExpireBeforeCommit
PreparationSettles == (phase \in {"activating", "preparing", "prepared"}) ~>
    (phase \in {"committed", "fallback", "attached",
                "unavailable", "incompatible", "closed", "active"})
CommittedSettles == (phase = "committed") ~>
                    (phase \in {"attached", "unavailable", "closed", "active"})
================================================================================
