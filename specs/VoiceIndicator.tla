---- MODULE VoiceIndicator -----------------------------------------------------
(***************************************************************************)
(* A toolbar projection of existing readiness facts, updated atomically.   *)
(***************************************************************************)
VARIABLES enabled, transport, prerequisites, playbackFailed, local, runtime,
          indicator, observed
vars == <<enabled, transport, prerequisites, playbackFailed, local, runtime,
          indicator, observed>>

View(e, t, p, f, l, r) ==
    IF ~e THEN "off"
    ELSE IF ~t \/ p = "unavailable" THEN "unavailable"
    ELSE IF l /\ r = "loading" THEN "starting"
    ELSE IF f THEN "unavailable"
    ELSE IF l /\ r = "failed" THEN "unavailable"
    ELSE IF p = "ready" /\ (~l \/ r = "ready") THEN "ready"
    ELSE "checking"

Init ==
    /\ enabled = FALSE /\ transport = FALSE /\ prerequisites = "unknown"
    /\ playbackFailed = FALSE /\ local = FALSE /\ runtime = "cold"
    /\ indicator = "off" /\ observed = FALSE

Observe ==
    /\ enabled' \in BOOLEAN /\ transport' \in BOOLEAN
    /\ prerequisites' \in {"unknown", "unavailable", "ready"}
    /\ playbackFailed' \in BOOLEAN /\ local' \in BOOLEAN
    /\ runtime' \in {"cold", "loading", "ready", "failed"}
    /\ indicator' = View(enabled', transport', prerequisites',
                         playbackFailed', local', runtime')
    /\ observed' = TRUE

Next == Observe
Spec == Init /\ [][Next]_vars /\ WF_vars(Observe)
TypeOK ==
    /\ enabled \in BOOLEAN /\ transport \in BOOLEAN
    /\ prerequisites \in {"unknown", "unavailable", "ready"}
    /\ playbackFailed \in BOOLEAN /\ local \in BOOLEAN
    /\ runtime \in {"cold", "loading", "ready", "failed"}
    /\ indicator \in {"off", "checking", "unavailable", "ready", "starting"}
    /\ observed \in BOOLEAN
Accurate == indicator = View(enabled, transport, prerequisites, playbackFailed,
                             local, runtime)
ReadyRequiresEvidence == indicator = "ready" =>
    enabled /\ transport /\ prerequisites = "ready" /\ ~playbackFailed
    /\ (~local \/ runtime = "ready")
OffWhenDisabled == ~enabled => indicator = "off"
EventuallyObserved == <>observed
================================================================================
