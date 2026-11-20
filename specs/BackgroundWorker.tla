---- MODULE BackgroundWorker ---------------------------------------------------
\* A bounded model of a main session's background worker and its result queue.
\* Generations are never reused. Switching sessions invalidates old work and
\* drops undelivered results; a late callback must not wake the new session.
\* One worker per generation completes at most once; duplicate callbacks are
\* outside this model and require separate implementation tests.
EXTENDS Naturals, FiniteSets

CONSTANTS Codex, Claude, MatchProvider, CheckGeneration, ConsumeResult,
          WakeListen, BypassOptIn, DropCompletion
ASSUME /\ Codex # Claude
       /\ MatchProvider \in BOOLEAN
       /\ CheckGeneration \in BOOLEAN
       /\ ConsumeResult \in BOOLEAN
       /\ WakeListen \in BOOLEAN
       /\ BypassOptIn \in BOOLEAN
       /\ DropCompletion \in BOOLEAN

Providers == {Codex, Claude}
Generations == {1, 2}
NoWorker == 0

VARIABLES generation, main, enabled, worker, started, completed, queued,
          delivered, listening
vars == <<generation, main, enabled, worker, started, completed, queued,
          delivered, listening>>

Init == /\ generation = 1
        /\ main \in Providers
        /\ enabled = [g \in Generations |-> FALSE]
        /\ worker = [g \in Generations |-> NoWorker]
        /\ started = {}
        /\ completed = {}
        /\ queued = {}
        /\ delivered = [g \in Generations |-> 0]
        /\ listening = FALSE

\* The session defaults off. Its explicit choice can change before a start.
ChooseEnabled(choice) ==
    /\ generation \notin started
    /\ enabled' = [enabled EXCEPT ![generation] = choice]
    /\ UNCHANGED <<generation, main, worker, started, completed, queued,
                   delivered, listening>>

\* An explicit start is admitted only when enabled, and uses the main provider.
Start == /\ generation \notin started
         /\ (enabled[generation] \/ BypassOptIn)
         /\ worker' = [worker EXCEPT ![generation] =
                         IF MatchProvider THEN main ELSE Codex]
         /\ started' = started \cup {generation}
         /\ UNCHANGED <<generation, main, enabled, completed, queued,
                        delivered, listening>>

\* A callback may arrive after a session switch. Each worker completes once.
Complete(g) == /\ g \in started \ completed
               /\ completed' = completed \cup {g}
               /\ queued' = IF DropCompletion \/
                               (CheckGeneration /\ g # generation)
                             THEN queued ELSE queued \cup {g}
               /\ UNCHANGED <<generation, main, enabled, worker, started,
                              delivered, listening>>

Listen == /\ ~listening
          /\ listening' = TRUE
          /\ UNCHANGED <<generation, main, enabled, worker, started,
                         completed, queued, delivered>>

\* Returning a result consumes it, so the next listen cannot receive it again.
Deliver(g) == /\ WakeListen /\ listening /\ g \in queued
              /\ delivered[g] < 2
              /\ queued' = IF ConsumeResult THEN queued \ {g} ELSE queued
              /\ delivered' = [delivered EXCEPT ![g] = @ + 1]
              /\ listening' = FALSE
              /\ UNCHANGED <<generation, main, enabled, worker, started,
                             completed>>

\* A replacement session chooses either provider and invalidates pending news.
Switch(p) == /\ generation = 1
             /\ generation' = 2
             /\ main' = p
             /\ queued' = {}
             /\ listening' = FALSE
             /\ UNCHANGED <<enabled, worker, started, completed, delivered>>

Next == \/ \E choice \in BOOLEAN : ChooseEnabled(choice)
        \/ Start
        \/ \E g \in Generations : Complete(g)
        \/ Listen
        \/ \E g \in Generations : Deliver(g)
        \/ \E p \in Providers : Switch(p)

\* An open listen with a queued result is eventually serviced if the session
\* remains current. No fairness is assumed for a caller to issue a listen.
Fairness == \A g \in Generations : WF_vars(Deliver(g))
Spec == Init /\ [][Next]_vars /\ Fairness

TypeOK == /\ generation \in Generations /\ main \in Providers
          /\ enabled \in [Generations -> BOOLEAN]
          /\ worker \in [Generations -> Providers \cup {NoWorker}]
          /\ started \subseteq Generations /\ completed \subseteq started
          /\ queued \subseteq completed
          /\ delivered \in [Generations -> 0..2]
          /\ listening \in BOOLEAN
OptIn == \A g \in started : enabled[g]
Conservation == generation \in completed =>
                  (generation \in queued \/ delivered[generation] > 0)
SameProvider == \A g \in started : g = generation => worker[g] = main
CurrentQueue == queued \subseteq {generation}
AtMostOnce == \A g \in Generations : delivered[g] <= 1
Wake == \A g \in Generations :
          (listening /\ g \in queued) ~> (delivered[g] > 0 \/ generation # g)
================================================================================
