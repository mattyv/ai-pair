---- MODULE OpenRouterBoot -----------------------------------------------------
EXTENDS Naturals, TLC

CONSTANTS MaxDocs
Docs == 1..MaxDocs
None == 0
VARIABLES generation, current, candidate, bootPending, ready, admitted, posted,
          slot, postDuringBoot, postWithoutAdmission
vars == <<generation, current, candidate, bootPending, ready, admitted, posted,
         slot, postDuringBoot, postWithoutAdmission>>

TypeOK == /\ generation \in Docs
          /\ current \in Docs
          /\ candidate \in 0..MaxDocs
          /\ bootPending \in BOOLEAN
          /\ ready \in BOOLEAN
          /\ admitted \in BOOLEAN
          /\ posted \in BOOLEAN
          /\ slot \in BOOLEAN
          /\ postDuringBoot \in BOOLEAN
          /\ postWithoutAdmission \in BOOLEAN
          /\ (bootPending => candidate # None)

Init == /\ generation = 1
        /\ current = 1
        /\ candidate = None
        /\ bootPending = FALSE
        /\ ready = TRUE
        /\ admitted = FALSE
        /\ posted = FALSE
        /\ slot = FALSE
        /\ postDuringBoot = FALSE
        /\ postWithoutAdmission = FALSE

PrepareBoot == /\ ~bootPending
               /\ generation < MaxDocs
               /\ generation' = generation + 1
               /\ candidate' = generation'
               /\ bootPending' = TRUE
               /\ admitted' = FALSE
               /\ UNCHANGED <<current, ready, posted, slot,
                              postDuringBoot, postWithoutAdmission>>
AckNewBoot == /\ bootPending
              /\ current' = candidate
              /\ candidate' = None
              /\ bootPending' = FALSE
              /\ ready' = FALSE
              /\ admitted' = FALSE
              /\ UNCHANGED <<generation, posted, slot,
                             postDuringBoot, postWithoutAdmission>>
ResumeCurrent == /\ bootPending
                 /\ candidate # None
                 /\ candidate' = None
                 /\ bootPending' = FALSE
                 /\ UNCHANGED <<generation, current, ready, admitted, posted,
                                slot, postDuringBoot, postWithoutAdmission>>
ProbeReady == /\ ~bootPending
               /\ ~ready
               /\ ready' = TRUE
               /\ UNCHANGED <<generation, current, candidate, bootPending,
                              admitted, posted, slot, postDuringBoot,
                              postWithoutAdmission>>
Admit == /\ ~bootPending
         /\ ready
         /\ ~admitted
         /\ ~slot
         /\ admitted' = TRUE
         /\ UNCHANGED <<generation, current, candidate, bootPending, ready,
                        posted, slot, postDuringBoot, postWithoutAdmission>>
Post == /\ ~bootPending
        /\ admitted
        /\ posted' = TRUE
        /\ postDuringBoot' = postDuringBoot \/ bootPending
        /\ postWithoutAdmission' = postWithoutAdmission \/ ~admitted
        /\ UNCHANGED <<generation, current, candidate, bootPending, ready,
                       admitted, slot>>
Decode == /\ ~bootPending
          /\ admitted
          /\ posted
          /\ ~slot
          /\ posted' = FALSE
          /\ slot' = TRUE
          /\ UNCHANGED <<generation, current, candidate, bootPending, ready,
                         admitted, postDuringBoot, postWithoutAdmission>>
Cancel == /\ admitted
          /\ admitted' = FALSE
          /\ UNCHANGED <<generation, current, candidate, bootPending, ready,
                         posted, slot, postDuringBoot, postWithoutAdmission>>
Settle == /\ slot
          /\ slot' = FALSE
          /\ admitted' = FALSE
          /\ UNCHANGED <<generation, current, candidate, bootPending, ready,
                         posted, postDuringBoot, postWithoutAdmission>>
DestroyDocument == /\ slot
                   /\ slot' = FALSE
                   /\ UNCHANGED <<generation, current, candidate, bootPending,
                                  ready, admitted, posted, postDuringBoot,
                                  postWithoutAdmission>>

Next == PrepareBoot \/ AckNewBoot \/ ResumeCurrent \/ ProbeReady
        \/ Admit \/ Post \/ Decode \/ Cancel \/ Settle \/ DestroyDocument
Spec == Init /\ [][Next]_vars

AdmissionFrozen == bootPending => ~admitted
NoPaidPostDuringBoot == ~postDuringBoot
PostHasAdmission == ~postWithoutAdmission
RetainSlotOnBoot == [][PrepareBoot => slot' = slot]_vars
RetainSlotOnRecovery == [][ResumeCurrent => slot' = slot]_vars

================================================================================
