---- MODULE SpeechContext ------------------------------------------------------
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS GuardGeneration,
          CancelPreserves,
          TrimHistory,
          AppendOnComplete,
          SnapshotPrior
VARIABLES generation,
          history,
          pending,
          pendingGeneration,
          snapshot,
          canceled,
          enabled,
          session,
          setting,
          nextText,
          badAppend,
          badSnapshot
vars ==
  << generation,
     history,
     pending,
     pendingGeneration,
     snapshot,
     canceled,
     enabled,
     session,
     setting,
     nextText,
     badAppend,
     badSnapshot
  >>
TypeOK ==
  /\ generation \in 0 .. 3 /\ pendingGeneration \in 0 .. 3
  /\ history \in Seq(1 .. 4) /\ snapshot \in Seq(1 .. 4)
  /\ pending \in 0 .. 4 /\ nextText \in 1 .. 5
  /\ session \in 1 .. 2 /\ setting \in 1 .. 2
  /\ canceled \in BOOLEAN /\ enabled \in BOOLEAN
  /\ badAppend \in BOOLEAN /\ badSnapshot \in BOOLEAN

Init ==
  /\ generation = 0 /\ history = <<>> /\ pending = 0
  /\ pendingGeneration = 0 /\ snapshot = <<>> /\ canceled = FALSE
  /\ enabled = TRUE /\ session = 1 /\ setting = 1 /\ nextText = 1
  /\ badAppend = FALSE /\ badSnapshot = FALSE
Reset ==
  /\ generation < 3 /\ generation' = generation + 1
  /\ history' = <<>> /\ UNCHANGED pending
  /\ UNCHANGED << pendingGeneration,
        snapshot,
        canceled,
        enabled,
        session,
        setting,
        nextText,
        badAppend,
        badSnapshot
     >>
Session ==
  /\ session' = 3 - session /\ generation < 3
  /\ generation' = generation + 1 /\ history' = <<>> /\ UNCHANGED pending
  /\ UNCHANGED << pendingGeneration,
        snapshot,
        canceled,
        enabled,
        setting,
        nextText,
        badAppend,
        badSnapshot
     >>
Configure ==
  /\ generation < 3 /\ setting' = 3 - setting
  /\ generation' = generation + 1 /\ history' = <<>> /\ UNCHANGED pending
  /\ UNCHANGED << pendingGeneration,
        snapshot,
        canceled,
        enabled,
        session,
        nextText,
        badAppend,
        badSnapshot
     >>
Toggle ==
  /\ generation < 3 /\ enabled' = ~enabled
  /\ generation' = generation + 1 /\ history' = <<>> /\ UNCHANGED pending
  /\ UNCHANGED << pendingGeneration,
        snapshot,
        canceled,
        session,
        setting,
        nextText,
        badAppend,
        badSnapshot
     >>
Capture ==
  /\ enabled /\ pending = 0 /\ nextText <= 4
  /\ pending' = nextText /\ pendingGeneration' = generation
  /\ snapshot' =
         ( IF SnapshotPrior THEN history ELSE Append(history, nextText) ) /\
       canceled' = FALSE
  /\ nextText' = nextText + 1
  /\ history' = IF AppendOnComplete THEN history ELSE Append(history, nextText)
  /\ badAppend' = ( badAppend \/ ~AppendOnComplete )
  /\ badSnapshot' = ( badSnapshot \/ ( snapshot' # history ) )
  /\ UNCHANGED << generation, enabled, session, setting >>
Complete ==
  /\ pending # 0
  /\ ( pendingGeneration = generation \/ ~GuardGeneration )
  /\ history' =
       IF TrimHistory /\ Len(history) = 3
       THEN Append(Tail(history), pending)
       ELSE Append(history, pending)
  /\ badAppend' =
       ( badAppend \/ canceled \/ ( pendingGeneration # generation ) )
  /\ pending' = 0
  /\ UNCHANGED << generation,
        pendingGeneration,
        snapshot,
        canceled,
        enabled,
        session,
        setting,
        nextText,
        badSnapshot
     >>
Cancel ==
  /\ pending # 0 /\ pending' = 0 /\ canceled' = TRUE
  /\ history' = IF CancelPreserves THEN history ELSE <<>>
  /\ badAppend' = ( badAppend \/ ( ~CancelPreserves /\ Len(history) > 0 ) )
  /\ UNCHANGED << generation,
        pendingGeneration,
        snapshot,
        enabled,
        session,
        setting,
        nextText,
        badSnapshot
     >>
Replay == UNCHANGED vars
Next ==
  Reset \/ Session \/ Configure \/ Toggle \/ Capture \/ Complete \/ Cancel \/
    Replay
Spec == Init /\ [][Next]_vars /\ WF_vars(Capture)
Bounded == Len(history) <= 3
ValidHistory == ~badAppend
PriorSnapshot == ~badSnapshot
EventualCapture ==
  []( enabled /\ pending = 0 /\ nextText <= 4 => <>( nextText > 1 \/ ~enabled )
  )
================================================================================
