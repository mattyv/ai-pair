---- MODULE Attention ----------------------------------------------------------
EXTENDS Naturals

VARIABLES attention, phase, speech, paused, cue, edits, oldEdits, cuePaused
vars == <<attention, phase, speech, paused, cue,
                        edits, oldEdits, cuePaused>>

Init == /\ attention = "none" /\ phase = "idle" /\ speech = FALSE
        /\ paused = FALSE /\ cue = FALSE /\ edits = 0
        /\ oldEdits = 0 /\ cuePaused = FALSE
Start == /\ attention = "none" /\ phase = "idle" /\ ~paused
         /\ phase' = "action"
         /\ UNCHANGED <<attention, speech, paused, cue,
                        edits, oldEdits, cuePaused>>
Speak == /\ phase = "action" /\ ~speech
         /\ speech' = TRUE
         /\ UNCHANGED <<attention, phase, paused, cue,
                        edits, oldEdits, cuePaused>>
Request == /\ attention = "none" /\ attention' = "requested"

         /\ UNCHANGED <<phase, speech, paused, cue,
                        edits, oldEdits, cuePaused>>
Boundary == /\ phase = "action" /\ phase' = "idle"
            /\ edits' = 1 - edits

         /\ UNCHANGED <<attention, speech, paused, cue, oldEdits, cuePaused>>
Drain == /\ speech /\ speech' = FALSE

         /\ UNCHANGED <<attention, phase, paused, cue,
                        edits, oldEdits, cuePaused>>
Grant == /\ attention = "requested" /\ phase = "idle" /\ ~speech
         /\ attention' = "granted" /\ cue' = ~paused
         /\ cuePaused' = paused /\ oldEdits' = edits

         /\ UNCHANGED <<phase, speech, paused, edits>>
Release == /\ attention # "none" /\ attention' = "none" /\ cue' = FALSE

         /\ UNCHANGED <<phase, speech, paused, edits, oldEdits, cuePaused>>
Pause == /\ paused' = ~paused

         /\ UNCHANGED <<attention, phase, speech, cue,
                        edits, oldEdits, cuePaused>>
Next == Start \/ Speak \/ Request \/ Boundary \/ Drain \/ Grant \/
        Release \/ Pause
Spec == Init /\ [][Next]_vars /\ WF_vars(Boundary) /\ WF_vars(Drain) /\
        WF_vars(Grant)
HeldStopsEdits == attention = "granted" => edits = oldEdits
GrantAfterDrain == attention = "granted" => phase = "idle" /\ ~speech
TypeOK == /\ attention \in {"none", "requested", "granted"}
          /\ phase \in {"idle", "action"}
          /\ speech \in BOOLEAN /\ paused \in BOOLEAN /\ cue \in BOOLEAN
          /\ cuePaused \in BOOLEAN /\ edits \in 0..1 /\ oldEdits \in 0..1
CueRespectsPause == cue => attention = "granted" /\ ~cuePaused
RequestedProgress == (attention = "requested") ~> (attention # "requested")
================================================================================
