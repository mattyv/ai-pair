---- MODULE SpeechWarmup -------------------------------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS MaxGeneration, GuardCurrent, GuardSingle, EnableStart
VARIABLES enabled, local, mode, generation, attempt, phase, workers, events
vars == <<enabled, local, mode, generation, attempt, phase, workers, events>>
Modes == {"cpu", "gpu"}
Eligible == enabled /\ local
Init == /\ enabled = FALSE /\ local = TRUE /\ mode = "cpu"
        /\ generation = 0 /\ attempt = 0 /\ phase = "idle" /\ workers = {}
        /\ events = {}
Change(e, l, m) ==
  /\ <<e, l, m>> # <<enabled, local, mode>>
  /\ generation < MaxGeneration
  /\ enabled' = e /\ local' = l /\ mode' = m
  /\ generation' = generation + 1 /\ attempt' = 0 /\ phase' = "idle"
  /\ UNCHANGED <<workers, events>>
Start == /\ EnableStart /\ Eligible /\ phase = "idle"
         /\ GuardSingle => workers = {}
         /\ workers' = workers \cup {<<generation, attempt>>}
         /\ phase' = "loading"
         /\ UNCHANGED <<enabled, local, mode, generation, attempt, events>>
Finish(g, a, result) ==
  /\ <<g, a>> \in workers /\ result \in {"ready", "failure"}
  /\ events' = events \cup {<<g, a, result>>}
  /\ UNCHANGED <<enabled, local, mode, generation, attempt, phase, workers>>
Deliver(g, a, result) ==
  /\ <<g, a, result>> \in events
  /\ events' = events \ {<<g, a, result>>}
  /\ phase' = IF (~GuardCurrent \/ (g = generation /\ a = attempt /\ Eligible
                                  /\ <<g, a>> \in workers /\ phase = "loading"))
               THEN result ELSE phase
  /\ UNCHANGED <<enabled, local, mode, generation, attempt, workers>>
Reap(g, a) == /\ <<g, a>> \in workers
           /\ (<<g, a>> # <<generation, attempt>> \/ ~Eligible
               \/ phase = "failure")
           /\ workers' = workers \ {<<g, a>>}
           /\ UNCHANGED <<enabled, local, mode, generation, attempt,
                          phase, events>>
Crash == /\ phase = "ready" /\ phase' = "failure"
         /\ UNCHANGED <<enabled, local, mode, generation, attempt,
                        workers, events>>
Retry == /\ Eligible /\ phase = "failure" /\ attempt < 1
         /\ attempt' = attempt + 1 /\ phase' = "idle"
         /\ UNCHANGED <<enabled, local, mode, generation, workers, events>>
Next == \/ \E e, l \in BOOLEAN, m \in Modes: Change(e, l, m)
        \/ Start \/ Retry \/ Crash
        \/ \E g \in 0..MaxGeneration, a \in 0..1, r \in {"ready", "failure"}:
             Finish(g, a, r) \/ Deliver(g, a, r)
        \/ \E g \in 0..MaxGeneration, a \in 0..1: Reap(g, a)
Spec == Init /\ [][Next]_vars
        /\ WF_vars(Start)
        /\ \A g \in 0..MaxGeneration, a \in 0..1: WF_vars(Reap(g, a))
DemandProgress == (Eligible /\ phase = "idle") ~>
                  (~Eligible \/ phase # "idle")
TypeOK == /\ enabled \in BOOLEAN /\ local \in BOOLEAN /\ mode \in Modes
          /\ generation \in 0..MaxGeneration /\ attempt \in 0..1
          /\ phase \in {"idle", "loading", "ready", "failure"}
          /\ workers \subseteq (0..MaxGeneration) \X (0..1)
          /\ events \subseteq ((0..MaxGeneration) \X (0..1)
                               \X {"ready", "failure"})
SingleWorker == Cardinality(workers) <= 1
CurrentResult == phase \in {"ready", "failure"} => Eligible
ReadyHasWorker == phase = "ready" => <<generation, attempt>> \in workers
================================================================================
