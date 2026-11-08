---- MODULE SpeechReminder -----------------------------------------------------
(******************************************************************************)
(* Count accepted batches, and remind only when speech is currently ready.  *)
(******************************************************************************)
EXTENDS Naturals

VARIABLES count, ready, reminder, selected, owed
vars == <<count, ready, reminder, selected, owed>>

TypeOK == /\ count \in 0..3 /\ ready \in BOOLEAN
          /\ reminder \in BOOLEAN /\ selected \in BOOLEAN /\ owed \in BOOLEAN
Init == /\ count = 0 /\ ready = FALSE /\ reminder = FALSE
        /\ selected = FALSE /\ owed = FALSE
Batch(spoken) ==
    /\ spoken \in BOOLEAN
    /\ selected' = spoken
    /\ count' = IF spoken THEN 0 ELSE IF count < 3 THEN count + 1 ELSE 3
    /\ reminder' = FALSE /\ owed' = FALSE
    /\ UNCHANGED ready
Readiness == /\ ready' \in BOOLEAN /\ reminder' = FALSE /\ owed' = FALSE
             /\ UNCHANGED <<count, selected>>
Report == /\ owed' = (ready /\ count = 3)
          /\ reminder' = (ready /\ count = 3)
          /\ count' = IF reminder' THEN 0 ELSE count
          /\ UNCHANGED <<ready, selected>>
Next == (\E spoken \in BOOLEAN: Batch(spoken)) \/ Readiness \/ Report
Spec == Init /\ [][Next]_vars
ReminderOnlyReady == reminder => ready
SelectedResets == selected => count = 0
DueIsReminded == owed => reminder
================================================================================
