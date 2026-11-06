---- MODULE PlaybackPreference -------------------------------------------------
(******************************************************************************)
(* The pace menu persists the selected mode without changing a running edit.  *)
(******************************************************************************)
EXTENDS Naturals

Modes == {"typing", "lines", "blocks"}
VARIABLES saved, selected, requested, running, actionMode, pace
vars == <<saved, selected, requested, running, actionMode, pace>>

TypeOK == /\ saved \in Modes /\ selected \in Modes /\ running \in BOOLEAN
          /\ requested \in Modes /\ actionMode \in Modes /\ pace \in 1..2
Init == /\ saved = "typing" /\ selected = "typing" /\ running = FALSE
        /\ requested = "typing" /\ actionMode = "typing" /\ pace = 1
Choose(mode) == /\ mode \in Modes /\ requested' = mode /\ saved' = mode
                /\ selected' = mode
                /\ UNCHANGED <<running, actionMode, pace>>
Start == /\ ~running /\ running' = TRUE /\ actionMode' = selected
         /\ UNCHANGED <<saved, selected, requested, pace>>
Finish == /\ running /\ running' = FALSE
          /\ UNCHANGED <<saved, selected, requested, actionMode, pace>>
SetPace == /\ pace' \in 1..2
           /\ UNCHANGED <<saved, selected, requested, running, actionMode>>
Reload == /\ selected' = saved
          /\ UNCHANGED <<saved, requested, running, actionMode, pace>>
Next == (\E mode \in Modes : Choose(mode)) \/ Start \/ Finish
        \/ SetPace \/ Reload
Spec == Init /\ [][Next]_vars
ChoiceSaved == selected = saved
ChoiceApplied == selected = requested
StableDuringChoice == [][running /\ requested' # requested =>
                         actionMode' = actionMode]_vars
NextActionUsesChoice == [][~running /\ running' => actionMode' = selected]_vars
PaceIndependent == [][pace' # pace =>
                      selected' = selected /\ actionMode' = actionMode]_vars
================================================================================
