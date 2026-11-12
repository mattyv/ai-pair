---- MODULE SpeechOverlap ------------------------------------------------------
(***************************************************************************)
(* One logical speech action shares an output owner's physical slot.       *)
(***************************************************************************)
EXTENDS Naturals

\* Stop invalidates logical work; only a matching terminal releases the slot.
VARIABLES session, epoch, serial, ownerEpoch, ownerJob, phase, mode, readDone,
          advanced, ended, canceled, receiptEpoch, receiptJob

vars == <<session, epoch, serial, ownerEpoch, ownerJob, phase, mode, readDone,
          advanced, ended, canceled, receiptEpoch, receiptJob>>

Init == /\ session = TRUE /\ epoch = 1 /\ serial = 0
        /\ ownerEpoch = 0 /\ ownerJob = 0 /\ phase = "idle"
        /\ mode = "wait" /\ readDone = FALSE /\ advanced = FALSE
        /\ ended = FALSE /\ canceled = FALSE
        /\ receiptEpoch = 0 /\ receiptJob = 0

Start(m) == /\ session /\ phase = "idle" /\ ownerJob = 0 /\ serial < 2
            /\ serial' = serial + 1 /\ ownerEpoch' = epoch
            /\ ownerJob' = serial + 1
            /\ mode' = m /\ phase' = "reading" /\ readDone' = FALSE
            /\ advanced' = FALSE /\ canceled' = FALSE
            /\ UNCHANGED <<session, epoch, ended, receiptEpoch, receiptJob>>

Read == /\ phase = "reading" /\ readDone' = TRUE /\ phase' = "gated"
        /\ UNCHANGED <<session, epoch, serial, ownerEpoch, ownerJob, mode,
                       advanced, ended, canceled, receiptEpoch, receiptJob>>

Advance == /\ session /\ phase = "gated" /\ (mode = "continue" \/ ownerJob = 0)
           /\ phase' = "idle" /\ advanced' = TRUE
           /\ UNCHANGED <<session, epoch, serial, ownerEpoch, ownerJob, mode,
                          readDone, ended, canceled, receiptEpoch, receiptJob>>

Terminal(e, j) == /\ ownerEpoch = e /\ ownerJob = j /\ j # 0
                  /\ ownerEpoch' = 0 /\ ownerJob' = 0
                  /\ receiptEpoch' = e /\ receiptJob' = j
                  /\ UNCHANGED <<session, epoch, serial, phase, mode, readDone,
                                 advanced, ended, canceled>>

Stop == /\ session /\ session' = FALSE /\ phase' = "idle" /\ canceled' = TRUE
        /\ UNCHANGED <<epoch, serial, ownerEpoch, ownerJob, mode, readDone,
                       advanced, ended, receiptEpoch, receiptJob>>

End == /\ session /\ phase = "idle" /\ ended' = TRUE /\ session' = FALSE
       /\ canceled' = TRUE
       /\ UNCHANGED <<epoch, serial, ownerEpoch, ownerJob, phase, mode,
                      readDone, advanced, receiptEpoch, receiptJob>>

NewSession == /\ ~session /\ epoch < 2 /\ session' = TRUE
              /\ epoch' = epoch + 1 /\ advanced' = FALSE
              /\ ended' = FALSE /\ readDone' = FALSE
              /\ UNCHANGED <<serial, ownerEpoch, ownerJob, phase, mode,
                             canceled, receiptEpoch, receiptJob>>

Next == (\E m \in {"wait", "continue"}: Start(m)) \/ Read \/ Advance \/
        (\E e \in 1..2, j \in 1..2: Terminal(e, j)) \/ Stop \/ NewSession \/ End

Spec == Init /\ [][Next]_vars

ProgressSpec == Spec /\ WF_vars(Read) /\ WF_vars(Advance) /\
  (\A e \in 1..2, j \in 1..2: WF_vars(Terminal(e, j)))

TypeOK == /\ session \in BOOLEAN /\ epoch \in 1..2 /\ serial \in 0..2
          /\ ownerEpoch \in 0..2 /\ ownerJob \in 0..2
          /\ phase \in {"idle", "reading", "gated"}
          /\ mode \in {"wait", "continue"}
          /\ readDone \in BOOLEAN /\ advanced \in BOOLEAN
          /\ ended \in BOOLEAN /\ canceled \in BOOLEAN
          /\ receiptEpoch \in 0..2 /\ receiptJob \in 0..2

WaitGate == advanced /\ mode = "wait" => ownerJob = 0
ReadingGate == advanced => readDone
NoOldOwner == ownerJob # 0 => ownerEpoch # 0
MatchingTerminal == [][ownerJob # 0 /\ ownerJob' = 0 =>
                      /\ receiptJob' = ownerJob
                      /\ receiptEpoch' = ownerEpoch]_vars
CancelOnEnd == ended => canceled
NoOverwrite == [][ownerJob # 0 /\ ownerJob' # 0 =>
                 /\ ownerJob' = ownerJob /\ ownerEpoch' = ownerEpoch]_vars
ContinueSpec == Spec /\ WF_vars(Read) /\ WF_vars(Advance)
ContinueProgress == []((session /\ phase = "gated" /\ mode = "continue") =>
                       (<>advanced \/ <>~session))
Progress == (<>[]session) => [](phase # "idle" => <> (phase = "idle"))
================================================================================
