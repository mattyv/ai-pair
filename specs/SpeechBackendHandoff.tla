---- MODULE SpeechBackendHandoff -----------------------------------------------
EXTENDS Naturals
CONSTANTS GuardReap, GuardCurrent, GuardPlanned
VARIABLES old, current, waiting, planned, successor, failed, overlap, stale
vars == <<old, current, waiting, planned, successor, failed, overlap, stale>>
Init == /\ old = "ready" /\ current = 1 /\ waiting = FALSE
        /\ planned = FALSE /\ successor = FALSE /\ failed = FALSE
        /\ overlap = FALSE /\ stale = FALSE
Begin == /\ old = "ready" /\ ~waiting /\ ~successor
         /\ old' = "retiring" /\ waiting' = TRUE /\ planned' = TRUE
         /\ failed' = (failed \/ ~GuardPlanned)
         /\ UNCHANGED <<current, successor, overlap, stale>>
Reap == /\ old = "retiring" /\ old' = "cold"
        /\ UNCHANGED <<current, waiting, planned, successor, failed,
                       overlap, stale>>
Cancel == /\ waiting /\ current = 1 /\ current' = 2
          /\ UNCHANGED <<old, waiting, planned, successor, failed,
                         overlap, stale>>
Continue == /\ waiting /\ (old = "cold" \/ ~GuardReap)
            /\ (current = 1 \/ ~GuardCurrent)
            /\ successor' = TRUE /\ waiting' = FALSE
            /\ overlap' = (overlap \/ old # "cold")
            /\ stale' = (stale \/ current # 1)
            /\ UNCHANGED <<old, current, planned, failed>>
Discard == /\ waiting /\ current # 1 /\ waiting' = FALSE
           /\ UNCHANGED <<old, current, planned, successor, failed,
                          overlap, stale>>
Next == Begin \/ Reap \/ Cancel \/ Continue \/ Discard
Spec == Init /\ [][Next]_vars /\ WF_vars(Reap) /\ WF_vars(Continue)
TypeOK == /\ old \in {"ready", "retiring", "cold"}
          /\ current \in 1..2
          /\ waiting \in BOOLEAN /\ planned \in BOOLEAN
          /\ successor \in BOOLEAN /\ failed \in BOOLEAN
          /\ overlap \in BOOLEAN /\ stale \in BOOLEAN
Safety == ~failed /\ ~overlap /\ ~stale
Progress == (waiting /\ current = 1) ~> (successor \/ current # 1)
================================================================================
