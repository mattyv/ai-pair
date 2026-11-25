---- MODULE FacepalmSettingsControl --------------------------------------------
\* Owner abstracts attachment and page; recheck stays passive and publishes
\* its snapshot only through the matching correlated result.
EXTENDS Naturals

VARIABLES owner, serial, pending, reply, published, authority, camera, beat
vars == <<owner, serial, pending, reply, published, authority, camera, beat>>
None == <<0, 0, "none">>
Kinds == {"open", "recheck"}
Ids == {1, 2} \X {1, 2} \X Kinds
Current(id) == id[1] = owner /\ id[2] = serial

Init ==
  /\ owner = 1 /\ serial = 0 /\ pending = None /\ reply = None
  /\ published = None /\ authority = None /\ camera = FALSE /\ beat = FALSE

Request(kind) ==
  /\ kind \in Kinds /\ pending = None /\ serial < 2
  /\ serial' = serial + 1 /\ pending' = <<owner, serial + 1, kind>>
  /\ published' = None /\ authority' = None
  /\ UNCHANGED <<owner, reply, camera, beat>>

Answer ==
  /\ pending # None /\ reply = None /\ reply' = pending
  /\ UNCHANGED <<owner, serial, pending, published, authority, camera, beat>>

Deliver ==
  /\ reply # None /\ reply = pending /\ Current(pending)
  /\ published' = reply /\ authority' = pending
  /\ pending' = None /\ reply' = None
  /\ UNCHANGED <<owner, serial, camera, beat>>

Drop ==
  /\ reply # None /\ reply # pending /\ reply' = None
  /\ UNCHANGED <<owner, serial, pending, published, authority, camera, beat>>

ReplaceOwner ==
  /\ owner < 2 /\ owner' = owner + 1 /\ pending' = None
  /\ published' = None /\ authority' = None
  /\ UNCHANGED <<serial, reply, camera, beat>>

Timeout ==
  /\ pending # None /\ pending' = None
  /\ UNCHANGED <<owner, serial, reply, published, authority, camera, beat>>

Beat ==
  /\ ~beat /\ beat' = TRUE /\ camera' = TRUE
  /\ UNCHANGED <<owner, serial, pending, reply, published, authority>>

Next == (\E kind \in Kinds: Request(kind)) \/ Answer \/ Deliver \/ Drop
        \/ ReplaceOwner \/ Timeout \/ Beat
Spec == Init /\ [][Next]_vars /\ WF_vars(Answer) /\ WF_vars(Deliver)
        /\ WF_vars(Drop) /\ WF_vars(Timeout)
TypeOK ==
  /\ owner \in 1..2 /\ serial \in 0..2
  /\ pending \in Ids \cup {None} /\ reply \in Ids \cup {None}
  /\ published \in Ids \cup {None} /\ authority \in Ids \cup {None}
  /\ camera \in BOOLEAN /\ beat \in BOOLEAN
PassiveInspection == camera => beat
CurrentRequest == pending # None => Current(pending)
CurrentPublication ==
  published # None => published = authority /\ Current(published)
Settles == (pending # None) ~> (pending = None)

\* Stable owner and responsive service: every admitted request publishes.
ServiceNext == (\E kind \in Kinds: Request(kind)) \/ Answer \/ Deliver
               \/ Drop \/ Beat
ServiceSpec == Init /\ [][ServiceNext]_vars /\ WF_vars(Answer)
               /\ WF_vars(Deliver) /\ WF_vars(Drop)
Success == (pending # None) ~> (published # None)
================================================================================
