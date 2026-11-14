---- MODULE AttentionCache -----------------------------------------------------
EXTENDS Integers
VARIABLES settings, generation, cache, job, valid, played, playGeneration
vars == <<settings, generation, cache, job, valid, played, playGeneration>>
Init == /\ settings = 0 /\ generation = 0 /\ cache = -1 /\ job = -1
        /\ valid = FALSE /\ played = -1 /\ playGeneration = -1
Change == /\ generation < 2 /\ settings' = 1 - settings
          /\ generation' = generation + 1 /\ cache' = -1 /\ valid' = FALSE
          /\ UNCHANGED <<job, played, playGeneration>>
Begin == /\ job = -1 /\ job' = generation /\ valid' = TRUE
         /\ UNCHANGED <<settings, generation, cache, played, playGeneration>>
Complete == /\ job # -1
            /\ cache' = IF valid /\ job = generation THEN job ELSE cache
            /\ job' = -1 /\ valid' = FALSE
            /\ UNCHANGED <<settings, generation, played, playGeneration>>
Cancel == /\ valid /\ valid' = FALSE
          /\ UNCHANGED <<settings, generation, cache, job, played,
                         playGeneration>>
Replay == /\ cache = generation /\ played' = cache
          /\ playGeneration' = generation
          /\ UNCHANGED <<settings, generation, cache, job, valid>>
Next == Change \/ Begin \/ Complete \/ Cancel \/ Replay
Spec == Init /\ [][Next]_vars /\ WF_vars(Complete)
TypeOK == /\ settings \in 0..1 /\ generation \in 0..2
          /\ cache \in -1..2 /\ job \in -1..2 /\ valid \in BOOLEAN
          /\ played \in -1..2 /\ playGeneration \in -1..2
CurrentCache == cache = -1 \/ cache = generation
CurrentPlayback == played = playGeneration
JobRetires == (job # -1) ~> (job = -1)
================================================================================
