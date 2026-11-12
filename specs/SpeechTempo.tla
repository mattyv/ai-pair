---- MODULE SpeechTempo --------------------------------------------------------
\* `slow` abstracts any supported non-normal 0.05-step listening rate; the
\* concrete numeric membership is checked at the settings and worker boundary.
EXTENDS Naturals

CONSTANTS GuardSnapshot, GuardStale, GuardBound, GuardTail, GuardExclusive,
          GuardDuration, GuardPlayRate,
          EnableTransform, EnablePlay, EnableRetire
VARIABLES unit, phase, selected, snapshot, busy, workerUnit, workerRate,
          outputFrames, tailFrames, playedUnit, playedRate, reading, approval,
          badStale, badSnapshot, badBound, badTail, badExclusive, watchdog,
          part, workerPart, totalFrames, playedSnapshot
vars == <<unit, phase, selected, snapshot, busy, workerUnit, workerRate,
          outputFrames, tailFrames, playedUnit, playedRate, reading, approval,
          badStale, badSnapshot, badBound, badTail, badExclusive, watchdog,
          part, workerPart, totalFrames, playedSnapshot>>

Init ==
  /\ unit = 0 /\ phase = "idle" /\ selected = "normal" /\ snapshot = "normal"
  /\ busy = FALSE /\ workerUnit = 0 /\ workerRate = "normal"
  /\ outputFrames = 0 /\ tailFrames = 0 /\ playedUnit = 0
  /\ playedRate = "normal" /\ reading = "held" /\ approval = "held"
  /\ badStale = FALSE /\ badSnapshot = FALSE /\ badBound = FALSE
  /\ badTail = FALSE /\ badExclusive = FALSE /\ watchdog = 0
  /\ part = 0 /\ workerPart = 0 /\ totalFrames = 0
  /\ playedSnapshot = "normal"

Admit ==
  /\ phase = "idle" /\ unit < 2 /\ (~busy \/ ~GuardExclusive)
  /\ unit' = unit + 1 /\ phase' = "admitted" /\ snapshot' = selected
  /\ badExclusive' = (badExclusive \/ busy)
  /\ outputFrames' = 0 /\ tailFrames' = 0
  /\ part' = 0 /\ totalFrames' = 0
  /\ UNCHANGED <<selected, busy, workerUnit, workerRate, playedUnit, playedRate,
                  reading, approval, badStale, badSnapshot, badBound, badTail,
                  watchdog,
                  workerPart, playedSnapshot>>
Select ==
  /\ selected' = IF selected = "normal" THEN "slow" ELSE "normal"
  /\ UNCHANGED <<unit, phase, snapshot, busy, workerUnit, workerRate,
                  outputFrames, tailFrames, playedUnit, playedRate, reading,
                  approval, badStale, badSnapshot, badBound, badTail,
                  badExclusive, watchdog,
                  part, workerPart, totalFrames, playedSnapshot>>
Transform ==
  /\ EnableTransform /\ phase = "admitted" /\ ~busy
  /\ busy' = TRUE /\ workerUnit' = unit /\ workerPart' = part
  /\ workerRate' = IF GuardSnapshot THEN snapshot ELSE selected
  /\ badSnapshot' = (badSnapshot \/ (~GuardSnapshot /\ selected # snapshot))
  /\ phase' = "transforming"
  /\ UNCHANGED <<unit, selected, snapshot, outputFrames, tailFrames, playedUnit,
                  playedRate, reading, approval, badStale, badBound, badTail,
                  badExclusive, watchdog,
                  part, totalFrames, playedSnapshot>>
Result(epoch, ordinal, rate, frames) ==
  LET valid == busy /\ epoch = workerUnit /\ ordinal = workerPart
               /\ rate = workerRate
      bounded == totalFrames + frames + (IF part = 1 THEN 1 ELSE 0) <= 10
      usable == phase = "transforming" /\ epoch = unit /\ ordinal = part
  IN
  /\ epoch \in 1..2 /\ ordinal \in 0..1
  /\ rate \in {"normal", "slow"} /\ frames \in {4, 8, 10}
  /\ (valid \/ ~GuardStale)
  /\ busy' = FALSE /\ workerUnit' = 0
  /\ badStale' = (badStale \/ ~valid \/ (usable /\ epoch # unit))
  /\ IF usable /\ (bounded \/ ~GuardBound)
       THEN /\ phase' = "ready" /\ outputFrames' = frames
            /\ totalFrames' = totalFrames + frames
            /\ tailFrames' = IF GuardTail /\ part = 1 THEN 1 ELSE 0
            /\ watchdog' = IF GuardDuration THEN frames + tailFrames'
                            ELSE 4 + tailFrames'
            /\ badBound' = (badBound \/ ~bounded)
            /\ badTail' = (badTail \/ (~GuardTail /\ part = 1))
       ELSE /\ phase' = IF phase \in {"canceled", "idle"}
                            THEN "idle" ELSE "failed"
            /\ outputFrames' = 0 /\ tailFrames' = 0 /\ watchdog' = 0
            /\ UNCHANGED totalFrames
            /\ UNCHANGED <<badBound, badTail>>
  /\ UNCHANGED <<unit, selected, snapshot, workerRate, playedUnit, playedRate,
                  reading, approval, badSnapshot, badExclusive,
                  part, workerPart, playedSnapshot>>
Play ==
  /\ EnablePlay /\ phase = "ready"
  /\ phase' = IF part = 1 THEN "idle" ELSE "between"
  /\ playedUnit' = IF part = 1 THEN unit ELSE playedUnit
  /\ playedRate' = IF GuardPlayRate THEN workerRate ELSE selected
  /\ playedSnapshot' = snapshot
  /\ UNCHANGED <<unit, selected, snapshot, busy, workerUnit, workerRate,
                  outputFrames, tailFrames, reading, approval, badStale,
                  badSnapshot, badBound, badTail, badExclusive, watchdog,
                  part, workerPart, totalFrames>>
Cancel ==
  /\ phase \in {"admitted", "transforming", "ready", "between"}
  /\ phase' = IF busy THEN "canceled" ELSE "idle"
  /\ outputFrames' = 0 /\ tailFrames' = 0
  /\ UNCHANGED <<unit, selected, snapshot, busy, workerUnit, workerRate,
                  playedUnit, playedRate, reading, approval, badStale,
                  badSnapshot, badBound, badTail, badExclusive, watchdog,
                  part, workerPart, totalFrames, playedSnapshot>>
Retire ==
  /\ EnableRetire /\ phase \in {"canceled", "idle"} /\ busy
  /\ busy' = FALSE /\ workerUnit' = 0 /\ phase' = "idle"
  /\ UNCHANGED <<unit, selected, snapshot, workerRate, outputFrames, tailFrames,
                  playedUnit, playedRate, reading, approval, badStale,
                  badSnapshot, badBound, badTail, badExclusive, watchdog,
                  part, workerPart, totalFrames, playedSnapshot>>
NextPart ==
  /\ phase = "between" /\ part = 0 /\ part' = 1 /\ phase' = "admitted"
  /\ UNCHANGED <<unit, selected, snapshot, busy, workerUnit, workerRate,
                  outputFrames, tailFrames, playedUnit, playedRate, reading,
                  approval, badStale, badSnapshot, badBound, badTail,
                  badExclusive, watchdog, workerPart, totalFrames,
                  playedSnapshot>>
Timeout ==
  /\ phase = "canceled" /\ busy /\ phase' = "idle"
  /\ UNCHANGED <<unit, selected, snapshot, busy, workerUnit, workerRate,
                  outputFrames, tailFrames, playedUnit, playedRate, reading,
                  approval, badStale, badSnapshot, badBound, badTail,
                  badExclusive, watchdog,
                  part, workerPart, totalFrames, playedSnapshot>>
Next == Admit \/ Select \/ Transform \/ Play \/ NextPart \/ Cancel
        \/ Retire \/ Timeout
        \/ (\E epoch \in 1..2, rate \in {"normal", "slow"},
               ordinal \in 0..1, frames \in {4, 8, 10}:
               Result(epoch, ordinal, rate, frames))
Spec == Init /\ [][Next]_vars
GoodResult == Result(unit, part, workerRate, 4)
HealthyNext == Admit \/ Transform \/ GoodResult \/ Play \/ NextPart
HealthySpec == Init /\ [][HealthyNext]_vars /\ WF_vars(Admit)
  /\ WF_vars(Transform) /\ WF_vars(GoodResult) /\ WF_vars(Play)
  /\ WF_vars(NextPart)
HealthyProgress == <> (playedUnit = 2)
CancelNext == Admit \/ Transform \/ Cancel \/ Retire \/ Timeout
CancelSpec == Init /\ [][CancelNext]_vars /\ WF_vars(Retire)
CancelProgress == (phase = "canceled" \/ (phase = "idle" /\ busy))
  ~> (phase = "idle" /\ ~busy)
TypeOK == /\ unit \in 0..2 /\ phase \in {"idle", "admitted", "transforming",
                                     "ready", "between", "canceled", "failed"}
          /\ selected \in {"normal", "slow"} /\ snapshot \in {"normal", "slow"}
          /\ workerUnit \in 0..2 /\ outputFrames \in 0..10
          /\ part \in 0..1 /\ workerPart \in 0..1 /\ totalFrames \in 0..10
NoStaleResult == ~badStale
ImmutableRate == ~badSnapshot /\ playedRate = playedSnapshot
BoundedOutput == ~badBound /\ totalFrames + tailFrames <= 10
AccurateDuration == phase = "ready" => watchdog = outputFrames + tailFrames
FixedTail == ~badTail /\
  (phase = "ready" => tailFrames = IF part = 1 THEN 1 ELSE 0)
OneWorker == ~badExclusive
ReadingApprovalHeld == reading = "held" /\ approval = "held"
================================================================================
