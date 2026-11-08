---- MODULE WarmSynthesisWorker ------------------------------------------------
EXTENDS Naturals

\* Guard* = FALSE removes one ownership check to model the wrong design.
\* Enable* = FALSE removes one action to model a missing step.
CONSTANTS GuardEpoch, GuardPart, GuardExit, GuardExitEpoch, GuardDiscard,
          GuardReady, GuardPause, GuardReplay, GuardBound, GuardCancel,
          GuardLate, GuardFailed, EnableLoad, EnableReady, EnableDispatch,
          EnableNextPart, EnableResult, EnableDiscard, EnableRetire,
          EnableExit
VARIABLES phase, epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
          paused, failed, canceledUnit, badOwnership, badReady, badDelivery,
          badPause, loads, completed
vars == <<phase, epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
          paused, failed, canceledUnit, badOwnership, badReady, badDelivery,
          badPause, loads, completed>>

Init ==
  /\ phase = "cold" /\ epoch = 0 /\ live = FALSE /\ caps = FALSE
  /\ unit = 0 /\ pendingUnit = 0 /\ pendingPart = 0 /\ delivered = 0
  /\ paused = FALSE /\ failed = FALSE /\ canceledUnit = 0
  /\ badOwnership = FALSE /\ badReady = FALSE /\ badDelivery = FALSE
  /\ badPause = FALSE /\ loads = 0 /\ completed = 0

Load ==
  /\ EnableLoad /\ phase \in {"cold", "dead"} /\ epoch < 2
  /\ (~live \/ ~GuardExit)
  /\ epoch' = epoch + 1 /\ phase' = "loading" /\ live' = TRUE
  /\ caps' = FALSE /\ failed' = (~GuardFailed /\ failed)
  /\ loads' = loads + 1 /\ badOwnership' = (badOwnership \/ live)
  /\ UNCHANGED <<unit, pendingUnit, pendingPart, delivered, paused,
                 canceledUnit, badReady, badDelivery, badPause, completed>>

\* Ready carries the validated capabilities of one epoch. Abstracted: valid or
\* invalid.
Ready(e, valid) ==
  /\ EnableReady /\ phase = "loading"
  /\ e \in 1..2 /\ valid \in BOOLEAN
  /\ (e = epoch \/ ~GuardEpoch) /\ (valid \/ ~GuardReady)
  /\ phase' = "ready" /\ caps' = valid
  /\ badReady' = (badReady \/ e # epoch \/ ~valid)
  /\ UNCHANGED <<epoch, live, unit, pendingUnit, pendingPart, delivered,
                 paused, failed, canceledUnit, badOwnership, badDelivery,
                 badPause, loads, completed>>

Dispatch ==
  /\ EnableDispatch /\ phase = "ready" /\ unit < 2
  /\ (~paused \/ ~GuardPause)
  /\ phase' = "busy" /\ unit' = unit + 1
  \* Without GuardReplay the request keeps naming the previous unit.
  /\ pendingUnit' = IF GuardReplay THEN unit + 1 ELSE unit
  /\ pendingPart' = 1
  /\ badPause' = (badPause \/ paused)
  /\ UNCHANGED <<epoch, live, caps, delivered, paused, failed, canceledUnit,
                 badOwnership, badReady, badDelivery, loads, completed>>

Result(e, u, p, size) ==
  /\ EnableResult /\ phase = "busy" /\ e \in 1..2 /\ u \in 1..2
  /\ p \in 1..2 /\ size \in 1..2
  /\ (size = 1 \/ ~GuardBound)
  /\ ((e = epoch /\ u = pendingUnit) \/ ~GuardEpoch)
  /\ (p = pendingPart \/ ~GuardPart)
  /\ delivered' = delivered + 1
  /\ badDelivery' = (badDelivery \/ e # epoch \/ u # pendingUnit
                     \/ p # pendingPart \/ size > 1)
  /\ IF p = 1
       THEN /\ pendingPart' = 2 /\ phase' = "between"
            /\ completed' = completed
       ELSE /\ phase' = "ready" /\ completed' = completed + 1
            /\ pendingPart' = pendingPart
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, paused, failed,
                 canceledUnit, badOwnership, badReady, badPause, loads>>

\* A response that arrives while the worker expects none: a result from a
\* previous epoch or unit after the slot became ready, a second part-one result
\* after the first was accepted, or a result after the worker was retired.
\* The guarded design rejects it before buffering, which changes nothing.
LateResult(e, u, p) ==
  /\ EnableResult /\ phase \notin {"busy", "discarding"}
  /\ e \in 1..2 /\ u \in 1..2 /\ p \in 1..2
  /\ badDelivery' = (badDelivery \/ ~GuardLate)
  /\ UNCHANGED <<phase, epoch, live, caps, unit, pendingUnit, pendingPart,
                 delivered, paused, failed, canceledUnit, badOwnership,
                 badReady, badPause, loads, completed>>

NextPart ==
  /\ EnableNextPart /\ phase = "between" /\ (~paused \/ ~GuardPause)
  /\ phase' = "busy" /\ badPause' = (badPause \/ paused)
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
                 paused, failed, canceledUnit, badOwnership, badReady,
                 badDelivery, loads, completed>>

Pause ==
  /\ ~paused /\ paused' = TRUE
  /\ UNCHANGED <<phase, epoch, live, caps, unit, pendingUnit, pendingPart,
                 delivered, failed, canceledUnit, badOwnership, badReady,
                 badDelivery, badPause, loads, completed>>
Resume ==
  /\ paused /\ paused' = FALSE
  /\ UNCHANGED <<phase, epoch, live, caps, unit, pendingUnit, pendingPart,
                 delivered, failed, canceledUnit, badOwnership, badReady,
                 badDelivery, badPause, loads, completed>>
Cancel ==
  /\ phase = "busy" /\ phase' = "discarding" /\ canceledUnit' = unit
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
                 paused, failed, badOwnership, badReady, badDelivery,
                 badPause, loads, completed>>
\* Cancelling between parts has no inference to discard: the unit ends at once
\* and its remaining part can never start.
CancelBetween ==
  /\ phase = "between"
  /\ phase' = IF GuardCancel THEN "ready" ELSE "between"
  /\ canceledUnit' = unit
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
                 paused, failed, badOwnership, badReady, badDelivery,
                 badPause, loads, completed>>
\* The canceled inference returns; its result is discarded and the warm worker
\* is reused.
DiscardResult(e, u, p) ==
  /\ EnableDiscard /\ phase = "discarding" /\ e \in 1..2 /\ u \in 1..2
  /\ p \in 1..2
  /\ ((e = epoch /\ u = pendingUnit /\ p = pendingPart) \/ ~GuardDiscard)
  /\ phase' = "ready"
  /\ badOwnership' = (badOwnership \/ e # epoch \/ u # pendingUnit
                      \/ p # pendingPart)
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
                 paused, failed, canceledUnit, badReady, badDelivery,
                 badPause, loads, completed>>
\* The independent watchdog (or a fatal error) retires the worker, which stays
\* the owner of the slot until it actually exits.
Retire ==
  /\ EnableRetire
  /\ phase \in {"loading", "ready", "busy", "between", "discarding"}
  /\ phase' = IF GuardExit THEN "retiring" ELSE "dead"
  /\ failed' = TRUE
  /\ UNCHANGED <<epoch, live, caps, unit, pendingUnit, pendingPart, delivered,
                 paused, canceledUnit, badOwnership, badReady, badDelivery,
                 badPause, loads, completed>>
Exit(e) ==
  /\ EnableExit /\ phase = "retiring" /\ e \in 1..2
  /\ (e = epoch \/ ~GuardExitEpoch)
  /\ phase' = "dead" /\ live' = FALSE
  /\ caps' = FALSE /\ badOwnership' = (badOwnership \/ e # epoch)
  /\ UNCHANGED <<epoch, unit, pendingUnit, pendingPart, delivered, paused,
                 failed, canceledUnit, badReady, badDelivery, badPause, loads,
                 completed>>
Next == Load \/ Dispatch \/ NextPart \/ Pause \/ Resume \/ Cancel
  \/ CancelBetween \/ Retire
  \/ (\E e \in 1..2, u \in 1..2, p \in 1..2:
       DiscardResult(e, u, p))
  \/ (\E e \in 1..2, u \in 1..2, p \in 1..2:
       LateResult(e, u, p))
  \/ (\E e \in 1..2, v \in BOOLEAN: Ready(e, v))
  \/ (\E e \in 1..2, u \in 1..2, p \in 1..2, size \in 1..2:
       Result(e, u, p, size))
  \/ (\E e \in 1..2: Exit(e))
Spec == Init /\ [][Next]_vars
GoodReady == Ready(epoch, TRUE)
GoodResult == Result(epoch, pendingUnit, pendingPart, 1)
HealthyNext == Load \/ GoodReady \/ Dispatch \/ GoodResult \/ NextPart
HealthySpec == Init /\ [][HealthyNext]_vars /\ WF_vars(Load)
  /\ WF_vars(GoodReady) /\ WF_vars(Dispatch) /\ WF_vars(GoodResult)
  /\ WF_vars(NextPart)
HealthyProgress == <> (completed = 2 /\ loads = 1)
RetirementSpec == Init /\ [][Next]_vars /\ WF_vars(Exit(epoch))
RetirementProgress == (phase = "retiring") ~> (phase = "dead")
GoodDiscard == DiscardResult(epoch, pendingUnit, pendingPart)
\* The canceled inference returns on its own: discard is fair, the watchdog is
\* not assumed (a retirement may still happen and must finish).
CancellationSpec == Init /\ [][Next]_vars /\ WF_vars(GoodDiscard)
  /\ WF_vars(Exit(epoch))
\* The canceled inference never returns: only the watchdog and the exit are
\* fair, so cancellation settles by retiring the worker.
WatchdogSpec == Init /\ [][Next]_vars /\ WF_vars(Retire)
  /\ WF_vars(Exit(epoch))
CancellationProgress == (phase = "discarding") ~> (phase \in {"ready", "dead"})
TypeOK == /\ phase \in {"cold", "loading", "ready", "busy", "between",
                        "retiring", "dead", "discarding"}
          /\ epoch \in 0..2 /\ unit \in 0..2 /\ canceledUnit \in 0..2
          /\ pendingUnit \in 0..2 /\ pendingPart \in 0..2
          /\ delivered \in 0..4 /\ completed \in 0..2 /\ loads \in 0..2
OneEngine == ~badOwnership /\ (phase \in {"loading", "ready", "busy",
                                         "between", "retiring",
                                         "discarding"} => live)
  /\ (phase \in {"cold", "dead"} => ~live)
ValidReady == ~badReady /\
  (phase \in {"ready", "busy", "between", "discarding"} => caps)
CorrectDelivery == ~badDelivery
NoPausedDispatch == ~badPause
NoReplay == (phase = "busy" => pendingUnit = unit)
NoCanceledResume == ~(phase = "busy" /\ unit # 0 /\ canceledUnit = unit)
\* A fatal error leaves the worker unavailable until a new epoch loads.
TruthfulUnavailable == failed = (phase \in {"retiring", "dead"})
================================================================================
