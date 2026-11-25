---- MODULE FacepalmSettingsNotice ---------------------------------------------
\* A late launcher failure belongs only to the accepted page request.
EXTENDS Naturals

VARIABLES owner, serial, operation, pending, accepted, late, published
vars == <<owner, serial, operation, pending, accepted, late, published>>
None == <<0, 0>>
Ids == {1, 2} \X {1, 2}

Init ==
  /\ owner = 1 /\ serial = 0 /\ operation = "none" /\ pending = None
  /\ accepted = None /\ late = None /\ published = None

\* Starting either a recheck or another launch revokes prior diagnostics.
Start(kind) ==
  /\ kind \in {"open", "recheck"}
  /\ serial < 2 /\ pending = None /\ serial' = serial + 1
  /\ operation' = kind
  /\ pending' = <<owner, serial + 1>>
  /\ accepted' = None /\ published' = None
  /\ UNCHANGED <<owner, late>>

\* Only an accepted settings launch can later have a launch failure.
Admit ==
  /\ pending # None /\ operation = "open"
  /\ accepted' = pending /\ pending' = None /\ operation' = "none"
  /\ UNCHANGED <<owner, serial, late, published>>

CompleteRecheck ==
  /\ pending # None /\ operation = "recheck"
  /\ pending' = None /\ operation' = "none"
  /\ UNCHANGED <<owner, serial, accepted, late, published>>

Late ==
  /\ accepted # None /\ late = None /\ late' = accepted
  /\ UNCHANGED <<owner, serial, operation, pending, accepted, published>>

Notice ==
  /\ late # None /\ late = accepted /\ late[1] = owner
  /\ published' = late /\ late' = None
  /\ UNCHANGED <<owner, serial, operation, pending, accepted>>

Drop ==
  /\ late # None /\ late # accepted /\ late' = None
  /\ UNCHANGED <<owner, serial, operation, pending, accepted, published>>

Replace ==
  /\ owner < 2 /\ owner' = owner + 1
  /\ pending' = None /\ accepted' = None /\ published' = None
  /\ operation' = "none"
  /\ UNCHANGED <<serial, late>>

Next == (\E kind \in {"open", "recheck"}: Start(kind))
        \/ Admit \/ CompleteRecheck \/ Late \/ Notice \/ Drop \/ Replace
Spec == Init /\ [][Next]_vars /\ WF_vars(Notice) /\ WF_vars(Drop)
TypeOK ==
  /\ owner \in 1..2 /\ serial \in 0..2
  /\ operation \in {"none", "open", "recheck"}
  /\ pending \in Ids \cup {None} /\ accepted \in Ids \cup {None}
  /\ late \in Ids \cup {None} /\ published \in Ids \cup {None}
RecheckNoAuthority == operation = "recheck" => accepted = None
CurrentNotice ==
  published # None =>
    pending = None /\ published = accepted /\ published[1] = owner
Progress == (late # None) ~> (late = None)
================================================================================
