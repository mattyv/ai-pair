---- MODULE PanelPlacement -----------------------------------------------------
(***************************************************************************
 * A prepared companion does not own a view until an irrevocable commit.  *
 * Timeout before commit may fall back; timeout after commit may not.      *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardPrepare, GuardFallback

VARIABLES phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback
vars == <<phase, tokenValid, committed, mainRegistered, companionRegistered,
          lateSeen, badEarly, badFallback>>

Init ==
    /\ phase = "idle" /\ tokenValid = FALSE /\ committed = FALSE
    /\ mainRegistered = FALSE /\ companionRegistered = FALSE
    /\ lateSeen = FALSE /\ badEarly = FALSE /\ badFallback = FALSE

Prepare ==
    /\ phase = "idle" /\ phase' = "preparing" /\ tokenValid' = TRUE
    /\ UNCHANGED <<committed, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback>>

Prepared ==
    /\ phase = "preparing" /\ tokenValid /\ phase' = "prepared"
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, lateSeen,
                   badFallback>>

Commit ==
    /\ phase = "prepared" /\ tokenValid /\ phase' = "committed"
    /\ committed' = TRUE
    /\ UNCHANGED <<tokenValid, mainRegistered, companionRegistered, lateSeen,
                   badEarly, badFallback>>

ExpireBeforeCommit ==
    /\ phase \in {"preparing", "prepared"} /\ ~committed
    /\ phase' = "fallback" /\ tokenValid' = FALSE /\ mainRegistered' = TRUE
    /\ UNCHANGED <<committed, companionRegistered, lateSeen, badEarly,
                   badFallback>>

LatePrepared ==
    /\ phase = "fallback" /\ ~lateSeen /\ lateSeen' = TRUE
    /\ companionRegistered' = IF GuardPrepare THEN companionRegistered ELSE TRUE
    /\ badEarly' = (badEarly \/ (~GuardPrepare /\ ~committed))
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered, badFallback>>

Register ==
    /\ committed /\ ~companionRegistered /\ companionRegistered' = TRUE
    /\ UNCHANGED <<phase, tokenValid, committed, mainRegistered, lateSeen,
                   badEarly, badFallback>>

Acknowledged ==
    /\ phase = "committed" /\ companionRegistered /\ phase' = "attached"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback>>

TimeoutAfterCommit ==
    /\ phase = "committed" /\ phase' = "unavailable"
    /\ UNCHANGED <<tokenValid, committed, mainRegistered, companionRegistered,
                   lateSeen, badEarly, badFallback>>

UnsafeFallback ==
    /\ ~GuardFallback /\ committed /\ ~mainRegistered
    /\ phase' = "fallback" /\ mainRegistered' = TRUE /\ badFallback' = TRUE
    /\ UNCHANGED <<tokenValid, committed, companionRegistered, lateSeen,
                   badEarly>>

Next == Prepare \/ Prepared \/ Commit \/ ExpireBeforeCommit \/ LatePrepared
        \/ Register \/ Acknowledged \/ TimeoutAfterCommit \/ UnsafeFallback
Spec == Init /\ [][Next]_vars /\ WF_vars(TimeoutAfterCommit) /\
        WF_vars(ExpireBeforeCommit)
TypeOK ==
    /\ phase \in {"idle", "preparing", "prepared", "committed", "attached",
                  "fallback", "unavailable"}
    /\ tokenValid \in BOOLEAN /\ committed \in BOOLEAN
    /\ mainRegistered \in BOOLEAN /\ companionRegistered \in BOOLEAN
    /\ lateSeen \in BOOLEAN /\ badEarly \in BOOLEAN /\ badFallback \in BOOLEAN
NoEarlyRegistration == ~badEarly
NoFallbackAfterCommit == ~badFallback
NoDuplicateRegistration == ~(mainRegistered /\ companionRegistered)
CanPrepare == phase = "idle" => ENABLED Prepare
CanCommit == phase = "prepared" => ENABLED Commit
CanRegister == (committed /\ ~companionRegistered) => ENABLED Register
CanFallback == phase \in {"preparing", "prepared"} => ENABLED ExpireBeforeCommit
PreparationSettles == (phase \in {"preparing", "prepared"}) ~>
    (phase \in {"committed", "fallback", "attached", "unavailable"})
CommittedSettles == (phase = "committed") ~>
                    (phase \in {"attached", "unavailable"})
================================================================================
