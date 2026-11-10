---- MODULE OutputPreference ---------------------------------------------------
EXTENDS Naturals
Choices == {"default", "device"}
Ids == 1..2
VARIABLES selected, stored, issued, settled, choices, owned, playing,
          discovery, displayed, pending, available
vars == <<selected, stored, issued, settled, choices, owned, playing,
          discovery, displayed, pending, available>>
TypeOK == /\ selected \in Choices /\ stored \in Choices
          /\ issued \in 0..2 /\ settled \in 0..issued
          /\ choices \in [Ids -> Choices] /\ owned \in BOOLEAN
          /\ playing \in BOOLEAN /\ discovery \in 0..2
          /\ displayed \in 0..discovery /\ pending \in SUBSET Ids
          /\ available \in BOOLEAN
Init == /\ selected \in Choices /\ stored = selected
        /\ issued = 0 /\ settled = 0 /\ choices = [i \in Ids |-> "default"]
        /\ owned = FALSE /\ playing = FALSE
        /\ discovery = IF selected = "device" THEN 1 ELSE 0
        /\ displayed = 0 /\ pending = IF selected = "device" THEN {1} ELSE {}
        /\ available = FALSE
Start == /\ ~playing /\ playing' = TRUE
         /\ UNCHANGED <<selected, stored, issued, settled, choices, owned,
                        discovery, displayed, pending, available>>
Finish == /\ playing /\ playing' = FALSE
          /\ UNCHANGED <<selected, stored, issued, settled, choices, owned,
                         discovery, displayed, pending, available>>
Select(c) == /\ c \in Choices /\ issued < 2
             /\ issued' = issued + 1 /\ selected' = c /\ playing' = FALSE
             /\ choices' = [choices EXCEPT ![issued + 1] = c] /\ owned' = TRUE
             /\ UNCHANGED <<stored, settled, discovery, displayed,
                            pending, available>>
WriteOK == /\ settled < issued /\ settled' = settled + 1
           /\ stored' = choices[settled + 1]
           /\ UNCHANGED <<selected, issued, choices, owned, playing, discovery,
                          displayed, pending, available>>
WriteFailed == /\ settled < issued /\ settled' = settled + 1
               /\ IF settled + 1 = issued
                  THEN /\ selected' = stored /\ owned' = FALSE
                       /\ playing' = FALSE
                  ELSE /\ UNCHANGED <<selected, owned, playing>>
               /\ UNCHANGED <<stored, issued, choices, discovery,
                              displayed, pending, available>>
Refresh == /\ discovery < 2 /\ discovery' = discovery + 1
           /\ pending' = pending \cup {discovery + 1}
           /\ UNCHANGED <<selected, stored, issued, settled, choices, owned,
                          playing, displayed, available>>
Complete(i, value) == /\ i \in pending /\ value \in BOOLEAN
                      /\ pending' = pending \ {i}
                      /\ IF i = discovery
                         THEN /\ displayed' = i /\ available' = value
                         ELSE /\ UNCHANGED <<displayed, available>>
                      /\ UNCHANGED <<selected, stored, issued, settled, choices,
                                     owned, playing, discovery>>
Next == Start \/ Finish \/ (\E c \in Choices: Select(c))
        \/ WriteOK \/ WriteFailed
        \/ Refresh \/ (\E i \in Ids, b \in BOOLEAN: Complete(i, b))
Spec == Init /\ [][Next]_vars /\ WF_vars(WriteOK \/ WriteFailed)
        /\ \A i \in Ids: WF_vars(\E b \in BOOLEAN: Complete(i, b))
StartupDiscovery == selected = "device" => discovery = 1 /\ pending = {1}
LatestHonored == owned => issued > 0 /\ selected = choices[issued]
EligibleSelect == issued < 2 => (\A c \in Choices: ENABLED Select(c))
ChoiceChangeStops == [][selected' # selected => ~playing']_vars
LatestDiscoverySettles == [](displayed < discovery => <>(displayed = discovery))
SelectionStops == [][issued' > issued => ~playing']_vars
StaleIgnored == [][\A i \in Ids, b \in BOOLEAN:
                    (i < discovery /\ Complete(i, b)) =>
                      /\ displayed' = displayed /\ available' = available]_vars
Settlement == [](settled < issued => <>(settled = issued))
================================================================================
