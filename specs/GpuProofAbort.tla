---- MODULE GpuProofAbort ------------------------------------------------------
EXTENDS Naturals
CONSTANTS GuardReap, GuardAbort, GuardKill
VARIABLES stage, live, aborted, settled, issued, overlap, late, killed
vars == <<stage, live, aborted, settled, issued, overlap, late, killed>>
Init == /\ stage = 0 /\ live = FALSE /\ aborted = FALSE
        /\ settled = FALSE /\ issued = FALSE /\ overlap = FALSE /\ late = FALSE
            /\ killed = FALSE
Spawn == /\ stage < 4 /\ ~settled /\ (~aborted \/ ~GuardAbort)
         /\ (~live \/ ~GuardReap) /\ overlap' = (overlap \/ live)
         /\ live' = TRUE /\ killed' = FALSE /\ late' = aborted /\ UNCHANGED
             <<stage, aborted, settled, issued>>
Abort == /\ ~aborted /\ ~settled /\ aborted' = TRUE /\ killed' = (live /\
                                                                  GuardKill)
         /\ UNCHANGED <<stage, live, settled, issued, overlap, late>>
Close == /\ live /\ live' = FALSE /\ stage' = stage + 1
         /\ UNCHANGED <<aborted, settled, issued, overlap, late, killed>>
Settle == /\ ~settled /\ (aborted \/ stage = 4)
          /\ (~live \/ ~GuardReap) /\ settled' = TRUE
          /\ issued' = ~aborted /\ UNCHANGED <<stage, live, aborted, overlap,
              late, killed>>
Next == Spawn \/ Abort \/ Close \/ Settle
Spec == Init /\ [][Next]_vars /\ WF_vars(Close) /\ WF_vars(Spawn) /\
    WF_vars(Settle)
TypeOK == /\ stage \in 0..4 /\ live \in BOOLEAN /\ aborted \in BOOLEAN
          /\ settled \in BOOLEAN /\ issued \in BOOLEAN /\ overlap \in BOOLEAN /\
              late \in BOOLEAN /\ killed \in BOOLEAN
NoOverlap == ~overlap
NoLateSpawn == ~late
AbortKills == (aborted /\ live) => killed
SettledReaped == settled => ~live
NoAbortedCapability == aborted => ~issued
Progress == ~settled ~> settled
================================================================================
