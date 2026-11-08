---- MODULE SentencePipeline ---------------------------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS GuardBuffer, GuardPause, GuardRoute, GuardStale, GuardFinal,
          GuardRetire, GuardSynthStale, GuardStarted, EnableSynthesis,
          EnablePlayback, EnableClose, EnableResume, EnableStop, EnableRelease
VARIABLES unit, phase, nextPart, started, closed, pending, ready, child,
          closing, route, systemRoute, total, completed, reading, approval,
          badBuffer, badPause, badRoute, badStale, badFinal, badRetire,
          playRoute, terminalPart, badSynth, badLookahead
vars == <<unit, phase, nextPart, started, closed, pending, ready, child,
          closing, route, systemRoute, total, completed, reading, approval,
          badBuffer, badPause, badRoute, badStale, badFinal, badRetire,
          playRoute, terminalPart, badSynth, badLookahead>>
Init ==
  /\ unit = 0 /\ phase = "idle" /\ nextPart = 1 /\ started = 0
  /\ closed = 0 /\ pending = 0 /\ ready = {} /\ child = 0
  /\ closing = FALSE /\ route = 0 /\ systemRoute = 1 /\ total = 0
  /\ completed = 0 /\ reading = "held" /\ approval = "held"
  /\ badBuffer = FALSE /\ badPause = FALSE /\ badRoute = FALSE
  /\ badStale = FALSE /\ badFinal = FALSE /\ badRetire = FALSE
  /\ playRoute = 0 /\ terminalPart = 0
  /\ badSynth = FALSE /\ badLookahead = FALSE
Admit ==
  /\ phase = "idle" /\ unit < 2 /\ unit' = unit + 1
  /\ phase' = "playing" /\ nextPart' = 1 /\ started' = 0 /\ closed' = 0
  /\ route' = systemRoute /\ total' = 0
  /\ UNCHANGED <<pending, ready, child, closing, systemRoute, completed,
                  reading, approval, badBuffer, badPause, badRoute, badStale,
                  badFinal, badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
Synthesize ==
  /\ EnableSynthesis /\ phase \in {"playing", "paused"} /\ pending = 0
  /\ nextPart <= 3 /\ (nextPart <= started + 1 \/ ~GuardStarted)
  /\ (phase = "playing" \/ ~GuardPause) /\ (ready = {} \/ ~GuardBuffer)
  /\ pending' = nextPart /\ nextPart' = nextPart + 1
  /\ badLookahead' = (badLookahead \/ nextPart > started + 1)
  /\ badPause' = (badPause \/ phase = "paused")
  /\ badBuffer' = (badBuffer \/ ready # {})
  /\ UNCHANGED <<unit, phase, started, closed, ready, child, closing, route,
                  systemRoute, total, completed, reading, approval, badRoute,
                  badStale, badFinal, badRetire,
                  playRoute, terminalPart,
                  badSynth>>
SynthDone(epoch, part, duration) ==
  /\ pending # 0 /\ duration \in 1..2
  /\ epoch \in 1..2 /\ part \in 1..3
  /\ ((epoch = unit /\ part = pending) \/ ~GuardSynthStale)
  /\ badSynth' = (badSynth \/ epoch # unit \/ part # pending)
  /\ IF phase = "canceled" \/ total + duration > 3
       THEN /\ ready' = {} /\ phase' = "canceled" /\ total' = total
       ELSE /\ ready' = ready \cup {pending} /\ phase' = phase
            /\ total' = total + duration
  /\ pending' = 0
  /\ UNCHANGED <<unit, nextPart, started, closed, child, closing, route,
                  systemRoute, completed, reading, approval, badBuffer,
                  badPause, badRoute, badStale, badFinal, badRetire,
                  playRoute, terminalPart,
                  badLookahead>>
Play ==
  /\ EnablePlayback /\ phase \in {"playing", "paused"} /\ child = 0
  /\ closed + 1 \in ready /\ (phase = "playing" \/ ~GuardPause)
  /\ playRoute' = IF GuardRoute THEN route ELSE systemRoute
  /\ child' = closed + 1
  /\ ready' = ready \ {closed + 1} /\ closing' = FALSE
  /\ badPause' = (badPause \/ phase = "paused")
  /\ badRoute' = (badRoute \/ (~GuardRoute /\ systemRoute # route))
  /\ UNCHANGED <<unit, phase, nextPart, started, closed, pending, route,
                  systemRoute,
                  total, completed, reading, approval, badBuffer, badStale,
                  badFinal, badRetire,
                  terminalPart,
                  badSynth, badLookahead>>
Started ==
  /\ child # 0 /\ ~closing /\ started < child
  /\ started' = child
  /\ UNCHANGED <<unit, phase, nextPart, closed, pending, ready, child, closing,
                  route, systemRoute, total, completed, reading, approval,
                  badBuffer, badPause, badRoute, badStale, badFinal,
                  badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
StopChild ==
  /\ EnableStop /\ phase = "canceled" /\ child # 0 /\ ~closing
  /\ closing' = TRUE
  /\ UNCHANGED <<unit, phase, nextPart, started, closed, pending, ready, child,
                  route, systemRoute, total, completed, reading, approval,
                  badBuffer, badPause, badRoute, badStale, badFinal,
                  badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
End(epoch, part) ==
  /\ child # 0 /\ ~closing /\ started = child
  /\ epoch \in 1..2 /\ part \in 1..3
  /\ ((epoch = unit /\ part = child) \/ ~GuardStale)
  /\ closing' = TRUE
  /\ badStale' = (badStale \/ epoch # unit \/ part # child)
  /\ badFinal' = (badFinal \/ (~GuardFinal /\ child # 3))
  /\ completed' = IF ~GuardFinal THEN unit ELSE completed
  /\ terminalPart' = IF ~GuardFinal THEN child ELSE terminalPart
  /\ phase' = IF ~GuardRetire THEN "idle" ELSE phase
  /\ badRetire' = (badRetire \/ ~GuardRetire)
  /\ UNCHANGED <<unit, nextPart, started, closed, pending, ready, child,
                  route, systemRoute, total, reading, approval, badBuffer,
                  badPause, badRoute,
                  playRoute,
                  badSynth, badLookahead>>
Close ==
  /\ EnableClose /\ child # 0 /\ closing
  /\ child' = 0 /\ closing' = FALSE /\ closed' = child
  /\ completed' = IF child = 3 /\ phase # "canceled" THEN unit
                   ELSE completed
  /\ terminalPart' = IF child = 3 /\ phase # "canceled" THEN child
                   ELSE terminalPart
  /\ phase' = IF child = 3 /\ phase # "canceled" THEN "idle" ELSE phase
  /\ UNCHANGED <<unit, nextPart, started, pending, ready, route, systemRoute,
                  total, reading, approval, badBuffer, badPause, badRoute,
                  badStale, badFinal, badRetire,
                  playRoute,
                  badSynth, badLookahead>>
Pause ==
  /\ phase = "playing" /\ phase' = "paused"
  /\ UNCHANGED <<unit, nextPart, started, closed, pending, ready, child,
                  closing, route, systemRoute, total, completed, reading,
                  approval, badBuffer, badPause, badRoute, badStale,
                  badFinal, badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
Resume ==
  /\ EnableResume /\ phase = "paused" /\ phase' = "playing"
  /\ UNCHANGED <<unit, nextPart, started, closed, pending, ready, child,
                  closing, route, systemRoute, total, completed, reading,
                  approval, badBuffer, badPause, badRoute, badStale,
                  badFinal, badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
Cancel ==
  /\ phase \in {"playing", "paused"} /\ phase' = "canceled" /\ ready' = {}
  /\ UNCHANGED <<unit, nextPart, started, closed, pending, child, closing,
                  route, systemRoute, total, completed, reading, approval,
                  badBuffer, badPause, badRoute, badStale, badFinal,
                  badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
ReleaseCanceled ==
  /\ EnableRelease /\ phase = "canceled" /\ pending = 0 /\ child = 0
  /\ phase' = "idle"
  /\ UNCHANGED <<unit, nextPart, started, closed, pending, ready, child,
                  closing, route, systemRoute, total, completed, reading,
                  approval, badBuffer, badPause, badRoute, badStale,
                  badFinal, badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
RouteChange ==
  /\ systemRoute' = 3 - systemRoute
  /\ UNCHANGED <<unit, phase, nextPart, started, closed, pending, ready, child,
                  closing, route, total, completed, reading, approval,
                  badBuffer, badPause, badRoute, badStale, badFinal,
                  badRetire,
                  playRoute, terminalPart,
                  badSynth, badLookahead>>
Next == Admit \/ Synthesize \/ (\E epoch \in 1..2, part \in 1..3,
                                  duration \in 1..2:
            SynthDone(epoch, part, duration))
        \/ Play \/ (\E epoch \in 1..2, part \in 1..3: End(epoch, part))
        \/ Started \/ StopChild \/ Close \/ Pause \/ Resume \/ Cancel
        \/ ReleaseCanceled \/ RouteChange
Spec == Init /\ [][Next]_vars
HealthyEnd == End(unit, child)
HealthySynthesis == SynthDone(unit, pending, 1)
HealthyNext == Admit \/ Synthesize \/ HealthySynthesis \/ Play \/ Started
               \/ HealthyEnd
               \/ Close \/ Pause \/ Resume
HealthySpec == Init /\ [][HealthyNext]_vars /\ WF_vars(Admit)
  /\ WF_vars(Synthesize) /\ WF_vars(HealthySynthesis) /\ WF_vars(Play)
  /\ WF_vars(Started) /\ WF_vars(HealthyEnd) /\ WF_vars(Close)
  /\ WF_vars(Resume)
CancelOnce == unit = 1 /\ Cancel
CanceledEnd == phase # "canceled" /\ HealthyEnd
CanceledNext == Admit \/ Synthesize \/ HealthySynthesis \/ Play \/ Started
                \/ CanceledEnd \/ Close \/ CancelOnce \/ StopChild
                \/ ReleaseCanceled
CanceledSpec == Init /\ [][CanceledNext]_vars /\ WF_vars(Admit)
  /\ WF_vars(Synthesize) /\ WF_vars(HealthySynthesis) /\ WF_vars(Play)
  /\ WF_vars(Started) /\ WF_vars(CanceledEnd) /\ WF_vars(Close)
  /\ WF_vars(CancelOnce) /\ WF_vars(StopChild) /\ WF_vars(ReleaseCanceled)
CanceledProgress == (phase = "canceled") ~> (phase = "idle")
HealthyProgress == (<>[] (phase # "paused")) => <> (completed = 2)
TypeOK == /\ unit \in 0..2
          /\ phase \in {"idle", "playing", "paused", "canceled"}
          /\ nextPart \in 1..4 /\ started \in 0..3 /\ closed \in 0..3
          /\ pending \in 0..3 /\ ready \subseteq 1..3 /\ child \in 0..3
          /\ route \in 0..2 /\ systemRoute \in 1..2 /\ total \in 0..3
NoExcessLookahead ==
  /\ ~badBuffer /\ ~badLookahead
  /\ Cardinality(ready) + (IF pending = 0 THEN 0 ELSE 1) <= 1
NoDispatchWhilePaused == ~badPause
FixedRoute == ~badRoute /\ (child # 0 => playRoute = route)
NoStaleEnd == ~badStale /\ ~badSynth
FinalOnly == ~badFinal /\ (completed # 0 => terminalPart = 3)
RetireBeforeRelease == ~badRetire /\ (child # 0 => phase # "idle")
ReadingApprovalHeld == reading = "held" /\ approval = "held"
ContiguousParts == child = 0 \/ child = closed + 1
AggregateBound == total <= 3
CanResume == phase = "paused" => ENABLED Resume
CanStart == phase = "playing" /\ nextPart = 1 => ENABLED Synthesize
================================================================================
