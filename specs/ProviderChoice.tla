---- MODULE ProviderChoice -----------------------------------------------------
(******************************************************************************)
(* UI choices take effect immediately; global writes settle in order.       *)
(******************************************************************************)
EXTENDS Naturals

Ids == 1..2
Providers == {"local", "cloud"}
VARIABLES desired, effective, stored, issued, settled, choices, active, owned,
          voice, storedVoice, voiceChoices, invalidated
vars == <<desired, effective, stored, issued, settled, choices, active, owned,
          voice, storedVoice, voiceChoices, invalidated>>
TypeOK == /\ desired \in Providers /\ effective \in Providers
          /\ stored \in Providers /\ issued \in 0..2 /\ settled \in 0..2
          /\ settled <= issued /\ choices \in [Ids -> Providers]
          /\ active \in 0..2 /\ owned \in BOOLEAN
          /\ voice \in {"old", "none"} /\ storedVoice \in {"old", "none"}
          /\ voiceChoices \in [Ids -> {"old", "none"}]
          /\ invalidated \in BOOLEAN
Init == /\ desired = "local" /\ effective = "local" /\ stored = "local"
        /\ issued = 0 /\ settled = 0 /\ active = 0 /\ owned = FALSE
        /\ choices = [i \in Ids |-> "local"]
        /\ voice = "old" /\ storedVoice = "old"
        /\ voiceChoices = [i \in Ids |-> "old"] /\ invalidated = FALSE
Select(p) == /\ p \in Providers /\ issued < 2
             /\ issued' = issued + 1 /\ active' = issued + 1 /\ owned' = TRUE
             /\ choices' = [choices EXCEPT ![issued + 1] = p]
             /\ voiceChoices' = [voiceChoices EXCEPT ![issued + 1] = voice]
             /\ desired' = p /\ effective' = p
             /\ UNCHANGED <<stored, settled, voice, storedVoice, invalidated>>
Success == /\ settled < issued /\ settled' = settled + 1
           /\ stored' = choices[settled + 1]
           /\ storedVoice' = voiceChoices[settled + 1]
           /\ UNCHANGED <<desired, effective, issued, choices, active, owned,
                          voice, voiceChoices, invalidated>>
Failure == /\ settled < issued /\ settled' = settled + 1
           /\ owned' = IF settled + 1 = issued THEN FALSE ELSE owned
           /\ voice' = IF settled + 1 = active /\ ~invalidated
                       THEN storedVoice ELSE voice
           /\ IF settled + 1 = active
              THEN /\ desired' = stored /\ effective' = stored /\ active' = 0
              ELSE /\ UNCHANGED <<desired, effective, active>>
           /\ UNCHANGED <<stored, issued, choices, storedVoice, voiceChoices,
                          invalidated>>
External(p) == /\ p \in Providers /\ settled = issued
               /\ desired' = p /\ effective' = p /\ stored' = p /\ active' = 0
               /\ owned' = FALSE
               /\ UNCHANGED <<issued, settled, choices, voice, storedVoice,
                              voiceChoices, invalidated>>
KeyChange == /\ issued < 2 /\ issued' = issued + 1
             /\ active' = issued + 1 /\ owned' = TRUE
             /\ choices' = [choices EXCEPT ![issued + 1] = effective]
             /\ voiceChoices' = [voiceChoices EXCEPT ![issued + 1] = "none"]
             /\ voice' = "none" /\ invalidated' = TRUE
             /\ UNCHANGED <<desired, effective, stored, settled, storedVoice>>
Next == (\E p \in Providers: Select(p)) \/ Success \/ Failure
        \/ (\E p \in Providers: External(p)) \/ KeyChange
Spec == Init /\ [][Next]_vars /\ WF_vars(Success \/ Failure)
ProviderAligned == desired = effective
LatestHonored == owned => issued > 0 /\ effective = choices[issued]
KeyClearsVoice == invalidated => voice = "none"
Settlement == [](settled < issued => <>(settled = issued))
================================================================================
