---- MODULE LocalFacepalm ------------------------------------------------------
\* The bridge composes with FacepalmSettings' physical socket close gate.
EXTENDS Naturals, FiniteSets

VARIABLES generation, serial, enabled, phase, physical, pending, cards,
          consumed, reply, result
vars == <<generation, serial, enabled, phase, physical, pending, cards,
          consumed, reply, result>>
None == <<0, 0>>
Ids == (1..2) \X (1..2)
Current(id) == id[1] = generation

Init ==
  /\ generation = 1 /\ serial = 0 /\ enabled = TRUE /\ phase = "idle"
  /\ physical = 0 /\ pending = None /\ cards = {} /\ consumed = {}
  /\ reply = None /\ result = "none"

\* Admission acknowledges immediately; queued work waits for physical close.
Accept ==
  /\ enabled /\ pending = None /\ (reply = None \/ ~Current(reply))
  /\ serial < 2
  /\ serial' = serial + 1 /\ pending' = <<generation, serial + 1>>
  /\ result' = "waiting"
  /\ phase' = IF phase = "idle" THEN "opening" ELSE phase
  /\ physical' = IF phase = "idle" THEN generation ELSE physical
  /\ UNCHANGED <<generation, enabled, cards, consumed, reply>>

Open ==
  /\ phase = "opening" /\ enabled /\ pending # None
  /\ phase' = "connected"
  /\ UNCHANGED <<generation, serial, enabled, physical, pending, cards,
                 consumed, reply, result>>

\* The external service answers asynchronously after command acknowledgement.
Answer ==
  /\ phase = "connected" /\ pending # None /\ reply = None
  /\ reply' = pending /\ pending' = None
  /\ UNCHANGED <<generation, serial, enabled, phase, physical, cards,
                 consumed, result>>

Deliver ==
  /\ reply # None /\ Current(reply) /\ enabled /\ phase = "connected"
  /\ cards' = cards \cup {reply} /\ reply' = None /\ result' = "delivered"
  /\ UNCHANGED <<generation, serial, enabled, phase, physical, pending,
                 consumed>>

Drop ==
  /\ reply # None /\ (~Current(reply) \/ ~enabled \/ phase # "connected")
  /\ reply' = None
  /\ UNCHANGED <<generation, serial, enabled, phase, physical, pending,
                 cards, consumed, result>>

Feel(id) ==
  /\ id \in cards /\ Current(id) /\ enabled /\ phase = "connected"
  /\ cards' = cards \ {id} /\ consumed' = consumed \cup {id}
  /\ UNCHANGED <<generation, serial, enabled, phase, physical, pending,
                 reply, result>>

Retire ==
  /\ generation < 2 /\ (phase # "idle" \/ pending # None \/ cards # {})
  /\ generation' = generation + 1 /\ pending' = None /\ cards' = {}
  /\ phase' = IF phase = "idle" THEN "idle" ELSE "retiring"
  /\ result' = IF result = "waiting" THEN "retired" ELSE result
  /\ UNCHANGED <<serial, enabled, physical, consumed, reply>>

Disable ==
  /\ enabled /\ generation < 2 /\ enabled' = FALSE
  /\ generation' = generation + 1 /\ pending' = None /\ cards' = {}
  /\ phase' = IF phase = "idle" THEN "idle" ELSE "retiring"
  /\ result' = IF result = "waiting" THEN "retired" ELSE result
  /\ UNCHANGED <<serial, physical, consumed, reply>>

Enable ==
  /\ ~enabled /\ enabled' = TRUE
  /\ UNCHANGED <<generation, serial, phase, physical, pending, cards,
                 consumed, reply, result>>

Close ==
  /\ phase = "retiring"
  /\ phase' = IF enabled /\ pending # None THEN "opening" ELSE "idle"
  /\ physical' = IF enabled /\ pending # None THEN generation ELSE 0
  /\ UNCHANGED <<generation, serial, enabled, pending, cards, consumed,
                 reply, result>>

Timeout ==
  /\ result = "waiting" /\ generation < 2
  /\ pending # None \/ (reply # None /\ Current(reply))
  /\ generation' = generation + 1 /\ pending' = None /\ cards' = {}
  /\ result' = "timeout"
  /\ phase' = IF phase = "idle" THEN "idle" ELSE "retiring"
  /\ UNCHANGED <<serial, enabled, physical, consumed, reply>>

Next == Accept \/ Open \/ Answer \/ Deliver \/ Drop \/ (\E id \in Ids: Feel(id))
        \/ Retire \/ Disable \/ Enable \/ Close \/ Timeout
Spec == Init /\ [][Next]_vars /\ WF_vars(Open) /\ WF_vars(Answer)
        /\ WF_vars(Deliver) /\ WF_vars(Drop) /\ WF_vars(Close)
        /\ WF_vars(Timeout)
TypeOK ==
  /\ generation \in 1..2 /\ serial \in 0..2 /\ enabled \in BOOLEAN
  /\ phase \in {"idle", "opening", "connected", "retiring"}
  /\ pending \in Ids \cup {None} /\ reply \in Ids \cup {None}
  /\ physical \in 0..2 /\ consumed \subseteq Ids
  /\ cards \subseteq Ids
  /\ result \in {"none", "waiting", "delivered", "retired", "timeout"}
CardsCurrent == \A id \in cards: Current(id) /\ enabled /\ phase = "connected"
NoOverlap == phase \in {"opening", "connected"} => physical = generation
OneFeel == cards \cap consumed = {}
DisabledNoDemand == ~enabled => pending = None /\ cards = {}
Settlement == (result = "waiting") ~> (result # "waiting")

\* Under a stable owner and a responsive service, every accepted beat succeeds.
ServiceNext == Accept \/ Open \/ Answer \/ Deliver \/ (\E id \in Ids: Feel(id))
ServiceSpec == Init /\ [][ServiceNext]_vars /\ WF_vars(Open)
               /\ WF_vars(Answer) /\ WF_vars(Deliver)
Success == (result = "waiting") ~> (result = "delivered")
================================================================================
