---- MODULE GpuMappedIcd -------------------------------------------------------
EXTENDS Naturals, FiniteSets

\* Objects abstract the loader, expected ICD, and any other ICD-exporting
\* object; ordinary inspected libraries are outside this finite abstraction.
\* Classification depends on defined exports, not filenames.
CONSTANTS Objects, Loader, Expected, GuardClassify
VARIABLES mapped, classified, unreadable, admitted, negativeAccepted
vars == <<mapped, classified, unreadable, admitted, negativeAccepted>>

TypeOK ==
  /\ mapped \subseteq Objects /\ classified \subseteq Objects
  /\ unreadable \subseteq Objects
  /\ admitted \in BOOLEAN /\ negativeAccepted \in BOOLEAN

Init ==
  /\ mapped = {} /\ classified = {} /\ unreadable = {}
  /\ admitted = FALSE /\ negativeAccepted = FALSE
Map(o) ==
  /\ o \in Objects /\ o \notin mapped /\ ~admitted /\ ~negativeAccepted
  /\ mapped' = mapped \cup {o}
  /\ UNCHANGED <<classified, unreadable, admitted, negativeAccepted>>
Inspect(o) ==
  /\ o \in mapped /\ o \notin classified /\ o \notin unreadable /\ ~admitted /\
      ~negativeAccepted
  /\ \/ /\ classified' = classified \cup {o} /\ UNCHANGED unreadable
     \/ /\ unreadable' = unreadable \cup {o} /\ UNCHANGED classified
  /\ UNCHANGED <<mapped, admitted, negativeAccepted>>
Admit ==
  /\ ~admitted /\ Expected \in mapped
  /\ ((mapped = classified /\ unreadable = {} /\ mapped \subseteq {Loader,
      Expected}) \/ ~GuardClassify)
  /\ admitted' = TRUE /\ UNCHANGED <<mapped, classified, unreadable,
      negativeAccepted>>
AcceptNegative ==
  /\ ~admitted /\ ~negativeAccepted /\ Loader \in mapped
  /\ ((mapped = classified /\ unreadable = {} /\ mapped = {Loader}) \/
      ~GuardClassify)
  /\ negativeAccepted' = TRUE /\ UNCHANGED <<mapped, classified, unreadable,
      admitted>>
Next == (\E o \in Objects : Map(o) \/ Inspect(o)) \/ Admit \/ AcceptNegative
Spec == Init /\ [][Next]_vars
Safe == admitted =>
  (Expected \in mapped /\ mapped = classified /\ unreadable = {}
   /\ mapped \subseteq {Loader, Expected})
NegativeSafe == negativeAccepted =>
  (mapped = {Loader} /\ mapped = classified /\ unreadable = {})
NeverAdmit == ~admitted
NeverAcceptNegative == ~negativeAccepted
================================================================================
