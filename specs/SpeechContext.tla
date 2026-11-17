---- MODULE SpeechContext ------------------------------------------------------
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS GuardGeneration,
          CancelPreserves,
          TrimHistory,
          AppendOnComplete,
          SnapshotPrior,
          ForeseePending
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
          badSnapshot,
          foreseen,
          foreseenFor,
          foreseenGeneration,
          completedLast,
          badForesight
\* #108: what `anticipate` foresaw for the pending line, and whether a capture
\* after that line completed saw something else.
foresight ==
  << foreseen, foreseenFor, foreseenGeneration, completedLast, badForesight >>
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
     badSnapshot,
     foreseen,
     foreseenFor,
     foreseenGeneration,
     completedLast,
     badForesight
  >>
TypeOK ==
  /\ generation \in 0 .. 3 /\ pendingGeneration \in 0 .. 3
  /\ history \in Seq(1 .. 5) /\ snapshot \in Seq(1 .. 5)
  /\ pending \in 0 .. 5 /\ nextText \in 1 .. 6
  /\ session \in 1 .. 2 /\ setting \in 1 .. 2
  /\ canceled \in BOOLEAN /\ enabled \in BOOLEAN
  /\ badAppend \in BOOLEAN /\ badSnapshot \in BOOLEAN
  /\ foreseen \in Seq(1 .. 5) /\ foreseenFor \in 0 .. 5
  /\ foreseenGeneration \in 0 .. 3 /\ completedLast \in 0 .. 5
  /\ badForesight \in BOOLEAN

Init ==
  /\ generation = 0 /\ history = <<>> /\ pending = 0
  /\ pendingGeneration = 0 /\ snapshot = <<>> /\ canceled = FALSE
  /\ enabled = TRUE /\ session = 1 /\ setting = 1 /\ nextText = 1
  /\ badAppend = FALSE /\ badSnapshot = FALSE
  /\ foreseen = <<>> /\ foreseenFor = 0 /\ foreseenGeneration = 0
  /\ completedLast = 0 /\ badForesight = FALSE
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
  /\ UNCHANGED foresight
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
  /\ UNCHANGED foresight
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
  /\ UNCHANGED foresight
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
  /\ UNCHANGED foresight
Capture ==
  /\ enabled /\ pending = 0 /\ nextText <= 5
  /\ pending' = nextText /\ pendingGeneration' = generation
  /\ snapshot' =
         ( IF SnapshotPrior THEN history ELSE Append(history, nextText) ) /\
       canceled' = FALSE
  /\ nextText' = nextText + 1
  /\ history' = IF AppendOnComplete THEN history ELSE Append(history, nextText)
  /\ badAppend' = ( badAppend \/ ~AppendOnComplete )
  /\ badSnapshot' = ( badSnapshot \/ ( snapshot' # history ) )
  \* #108: the capture after a foreseen line completed, with no reset since,
  \* sees what was foreseen.
  /\ badForesight' =
       ( badForesight \/
         ( foreseenFor # 0 /\ foreseenFor = completedLast
           /\ foreseenGeneration = generation /\ snapshot' # foreseen ) )
  /\ foreseenFor' = 0
  /\ UNCHANGED << foreseen, foreseenGeneration, completedLast >>
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
  /\ completedLast' = pending
  /\ UNCHANGED << foreseen, foreseenFor, foreseenGeneration, badForesight >>
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
  /\ UNCHANGED foresight
\* #108: `anticipate` foresees the history the next capture will see if the
\* pending line completes: it appended and trimmed as Complete does, with no
\* other change.
Anticipate ==
  /\ pending # 0
  /\ foreseen' =
       IF ~ForeseePending THEN history
       ELSE IF TrimHistory /\ Len(history) = 3
            THEN Append(Tail(history), pending)
            ELSE Append(history, pending)
  /\ foreseenFor' = pending
  /\ foreseenGeneration' = generation
  /\ UNCHANGED << generation,
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
        badSnapshot,
        completedLast,
        badForesight
     >>
Replay == UNCHANGED vars
Next ==
  Reset \/ Session \/ Configure \/ Toggle \/ Capture \/ Complete \/ Cancel \/
    Anticipate \/ Replay
Spec == Init /\ [][Next]_vars /\ WF_vars(Capture)
Bounded == Len(history) <= 3
ValidHistory == ~badAppend
PriorSnapshot == ~badSnapshot
AnticipationExact == ~badForesight
EventualCapture ==
  []( enabled /\ pending = 0 /\ nextText <= 5 => <>( nextText > 1 \/ ~enabled )
  )
================================================================================
