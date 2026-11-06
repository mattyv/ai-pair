---- MODULE DiagnosticsPrivacy -------------------------------------------------
(******************************************************************************)
(* A bounded diagnostics history keeps only explicitly selected fields. A    *)
(* raw event carries an extra secret to model text that must never be copied. *)
(* Timestamps and concrete lifecycle values are abstracted to safe values.  *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Capacity, Secret

ASSUME Capacity \in Nat \ {0}
Kinds == {"session", "connection", "command"}
Values == {1, 2}
RawEvents == [kind : Kinds, value : Values, secret : {Secret}]
SafeEvents == [kind : Kinds, value : Values]
Safe(raw) == [kind |-> raw.kind, value |-> raw.value]

VARIABLES history, copied, action, last
vars == <<history, copied, action, last>>

TypeOK ==
    /\ history \in Seq(SafeEvents)
    /\ copied \in Seq(SafeEvents)
    /\ action \in {"none", "record", "copy"}
    /\ last \in SafeEvents

Init ==
    /\ history = <<>>
    /\ copied = <<>>
    /\ action = "none"
    /\ last = [kind |-> "session", value |-> 1]

Record(raw) ==
    /\ raw \in RawEvents
    /\ history' = IF Len(history) < Capacity
                  THEN Append(history, Safe(raw))
                  ELSE Append(Tail(history), Safe(raw))
    /\ last' = Safe(raw)
    /\ action' = "record"
    /\ UNCHANGED copied

Copy ==
    /\ copied' = history
    /\ action' = "copy"
    /\ UNCHANGED <<history, last>>

Next == (\E raw \in RawEvents : Record(raw)) \/ Copy
Spec == Init /\ [][Next]_vars /\ WF_vars(\E raw \in RawEvents : Record(raw))

Bounded == Len(history) <= Capacity /\ Len(copied) <= Capacity
OnlyAllowed == /\ \A i \in 1..Len(history) :
                       DOMAIN history[i] = {"kind", "value"}
               /\ \A i \in 1..Len(copied) :
                       DOMAIN copied[i] = {"kind", "value"}
CopiedExactly == action = "copy" => copied = history
Recorded == action = "record" =>
    Len(history) > 0 /\ last = history[Len(history)]
RecordsEventually == <> (action = "record")
================================================================================
