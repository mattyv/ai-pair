---- MODULE Attention ----------------------------------------------------------
EXTENDS Naturals

VARIABLES attention, phase, speech, paused, cue, edits, oldEdits,
                        cuePaused, notice, generation, deliveredGeneration
vars == <<attention, phase, speech, paused, cue,
                        edits, oldEdits, cuePaused, notice, generation,
                        deliveredGeneration>>

Init == /\ attention = "none" /\ phase = "idle" /\ speech = FALSE
        /\ paused = FALSE /\ cue = FALSE /\ edits = 0
        /\ oldEdits = 0 /\ cuePaused = FALSE /\ notice = FALSE
        /\ generation = 0 /\ deliveredGeneration = 0
Start == /\ attention = "none" /\ phase = "idle" /\ ~paused
         /\ phase' = "action"
         /\ UNCHANGED <<attention, speech, paused, cue,
                        edits, oldEdits, cuePaused, notice, generation,
                        deliveredGeneration>>
Speak == /\ phase = "action" /\ ~speech
         /\ speech' = TRUE
         /\ UNCHANGED <<attention, phase, paused, cue,
                        edits, oldEdits, cuePaused, notice, generation,
                        deliveredGeneration>>
Request == /\ attention = "none" /\ generation < 2
           /\ attention' = "requested" /\ generation' = generation + 1

         /\ UNCHANGED <<phase, speech, paused, cue,
                        edits, oldEdits, cuePaused, notice,
                        deliveredGeneration>>
Boundary == /\ phase = "action" /\ phase' = "idle"
            /\ edits' = 1 - edits

         /\ UNCHANGED <<attention, speech, paused, cue, oldEdits,
                        cuePaused, notice, generation, deliveredGeneration>>
Drain == /\ speech /\ speech' = FALSE

         /\ UNCHANGED <<attention, phase, paused, cue,
                        edits, oldEdits, cuePaused, notice, generation,
                        deliveredGeneration>>
Grant == /\ attention = "requested" /\ phase = "idle" /\ ~speech
         /\ attention' = "granted" /\ cue' = ~paused
         /\ cuePaused' = paused /\ oldEdits' = edits /\ notice' = TRUE

         /\ UNCHANGED <<phase, speech, paused, edits, generation,
                        deliveredGeneration>>
Release == /\ attention # "none" /\ attention' = "none" /\ cue' = FALSE
           /\ notice' = FALSE

         /\ UNCHANGED <<phase, speech, paused, edits, oldEdits, cuePaused,
                        generation, deliveredGeneration>>
Pause == /\ paused' = ~paused

         /\ UNCHANGED <<attention, phase, speech, cue,
                        edits, oldEdits, cuePaused, notice, generation,
                        deliveredGeneration>>
Acknowledge == /\ notice /\ notice' = FALSE /\ deliveredGeneration' = generation
               /\ UNCHANGED <<attention, phase, speech, paused, cue, edits,
                        oldEdits, cuePaused, generation>>
Restore == /\ attention = "granted" /\ deliveredGeneration = generation
           /\ notice' = TRUE
           /\ UNCHANGED <<attention, phase, speech, paused, cue, edits,
                        oldEdits, cuePaused, generation, deliveredGeneration>>
Next == Restore \/ Acknowledge \/ Start \/ Speak \/ Request \/ Boundary
        \/ Drain \/ Grant \/
        Release \/ Pause
Spec == Init /\ [][Next]_vars /\ WF_vars(Boundary) /\ WF_vars(Drain) /\
        WF_vars(Grant) /\ WF_vars(Acknowledge)
NoticeIsGranted == notice => attention = "granted"
NoticeDelivered == notice ~> ~notice
HeldStopsEdits == attention = "granted" => edits = oldEdits
GrantAfterDrain == attention = "granted" => phase = "idle" /\ ~speech
TypeOK == /\ attention \in {"none", "requested", "granted"}
          /\ phase \in {"idle", "action"}
          /\ speech \in BOOLEAN /\ paused \in BOOLEAN /\ cue \in BOOLEAN
          /\ generation \in 0..2 /\ deliveredGeneration \in 0..2
          /\ notice \in BOOLEAN /\ cuePaused \in BOOLEAN /\ edits \in 0..1
          /\ oldEdits \in 0..1
CueRespectsPause == cue => attention = "granted" /\ ~cuePaused
RequestedProgress == (attention = "requested") ~> (attention # "requested")
================================================================================
