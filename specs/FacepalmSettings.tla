---- MODULE FacepalmSettings ---------------------------------------------------
\* One subscription's desired setting, socket retirement and card evidence.
EXTENDS Naturals

VARIABLES enabled, generation, phase, operation, delivered, retired
vars == <<enabled, generation, phase, operation, delivered, retired>>

Init ==
  /\ enabled = TRUE /\ generation = 0 /\ phase = "idle"
  /\ operation = 0 /\ delivered = FALSE /\ retired = FALSE

Beat ==
  /\ enabled /\ phase = "idle" /\ generation < 2
  /\ phase' = "opening" /\ operation' = generation /\ retired' = FALSE
  /\ delivered' = FALSE /\ UNCHANGED <<enabled, generation>>

Connect ==
  /\ phase = "opening" /\ enabled /\ operation = generation
  /\ phase' = "connected"
  /\ UNCHANGED <<enabled, generation, operation, delivered, retired>>

Answer ==
  /\ phase = "connected" /\ enabled /\ operation = generation
  /\ delivered' = TRUE
  /\ UNCHANGED <<enabled, generation, phase, operation, retired>>

Disable ==
  /\ enabled /\ generation < 2 /\ enabled' = FALSE
  /\ generation' = generation + 1
  /\ phase' = (IF phase = "idle" THEN "idle" ELSE "retiring")
  /\ retired' = TRUE /\ delivered' = FALSE /\ UNCHANGED operation

Enable ==
  /\ ~enabled /\ enabled' = TRUE
  /\ UNCHANGED <<generation, phase, operation, delivered, retired>>

Retire ==
  /\ phase \in {"opening", "connected"} /\ generation < 2
  /\ generation' = generation + 1 /\ phase' = "retiring"
  /\ retired' = TRUE /\ delivered' = FALSE /\ UNCHANGED <<enabled, operation>>

Close ==
  /\ phase = "retiring" /\ phase' = "idle"
  /\ UNCHANGED <<enabled, generation, operation, delivered, retired>>

Next == Close \/ UNCHANGED vars \/ Beat \/ Connect \/ Answer \/ Disable
        \/ Enable \/ Retire
Spec == Init /\ [][Next]_vars /\ WF_vars(Connect) /\ WF_vars(Answer)
        /\ WF_vars(Close)

TypeOK ==
  /\ enabled \in BOOLEAN /\ generation \in 0..2
  /\ phase \in {"idle", "opening", "connected", "retiring"}
  /\ operation \in 0..2 /\ delivered \in BOOLEAN /\ retired \in BOOLEAN

DisabledIdle == ~enabled => phase \in {"idle", "retiring"}
CurrentConnection ==
  phase \in {"opening", "connected"} =>
    enabled /\ operation = generation /\ ~retired
CardCurrent ==
  delivered => phase = "connected" /\ enabled /\ operation = generation
Progress ==
  (phase = "connected") ~> (delivered \/ phase \in {"idle", "retiring"})
================================================================================
