---- MODULE SpeechLookahead ----------------------------------------------------
(******************************************************************************)
(* Synthesizing the next narration line while the current one plays, for     *)
(* #108: `SpeechService.prepare` and its prepared slot in                     *)
(* packages/vscode/src/speech_service.ts, hinted by core's `Player`. A cloud  *)
(* line is one request; there is one request slot, shared by the line playing *)
(* and the one prepared. A prepared line is played only when its request is   *)
(* exactly the one the line would make at its own turn (its text, the         *)
(* settings, and the previous line it follows); anything else is discarded    *)
(* and the line makes its own. Checked: what plays is what would have been    *)
(* requested, in order, one line ahead at most, one request at a time, waste  *)
(* only on a disruption, every spoken line finishes, and without disruptions  *)
(* the prepared line is used.                                                 *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    N,            \* lines in the agent's plan
    Texts,        \* what a line can say
    MaxConfig,    \* settings changes the check covers
    MaxDisrupt,   \* disruptions: cancels, settings changes, replans, failures
    MaxPauses     \* pauses the check covers

ASSUME AssumeBounds ==
    /\ N \in Nat /\ MaxConfig \in Nat
    /\ MaxDisrupt \in Nat /\ MaxPauses \in Nat

VARIABLES
    plan,         \* the text of each line, as the agent's batches hold them
    next,         \* the next line to speak; N + 1 when none is left
    config,       \* the speech settings' generation
    ahead,        \* the look-ahead setting
    last,         \* the last line that played to its end: the previous text
    current,      \* the line being spoken, or NoLine
    hint,         \* the next line core announced, or 0
    hinted,       \* the line the hint was given during: one hint a line
    prepared,     \* the prepared lines: at most one
    live,         \* who owns a request in flight: current, prepared, retired
    paused,
    played,       \* ghost: each line played, what it used, what it expected
    wasted,       \* ghost: prepared requests discarded
    disruptions,  \* ghost: cancels, settings changes, replans, failures
    pauses        \* ghost: pauses so far

vars == <<plan, next, config, ahead, last, current, hint, hinted, prepared,
          live, paused, played, wasted, disruptions, pauses>>

NoKey == <<>>
NoLine == [line |-> 0, phase |-> "none", key |-> NoKey, used |-> NoKey,
           early |-> FALSE]
Phases == {"none", "waiting", "requesting", "ready", "playing"}
Owners == {"current", "prepared", "retired"}

\* A request: the line's text, the settings, and the line it follows.
Key(l, c, p) == <<plan[l], c, p>>

TypeOK ==
    /\ plan \in [1..N -> Texts]
    /\ next \in 1..(N + 1)
    /\ config \in 0..MaxConfig
    /\ ahead \in BOOLEAN
    /\ last \in 0..N
    /\ current.line \in 0..N /\ current.phase \in Phases
    /\ current.early \in BOOLEAN
    /\ hint \in 0..N /\ hinted \in 0..N
    /\ \A p \in prepared : p.line \in 1..N /\ p.state \in {"flight", "ready"}
    /\ live \subseteq Owners
    /\ paused \in BOOLEAN
    /\ wasted \in Nat
    /\ disruptions \in 0..MaxDisrupt /\ pauses \in 0..MaxPauses

--------------------------------------------------------------------------------

Init ==
    /\ plan \in [1..N -> Texts]
    /\ next = 1
    /\ config = 0
    /\ ahead \in BOOLEAN
    /\ last = 0
    /\ current = NoLine
    /\ hint = 0
    /\ hinted = 0
    /\ prepared = {}
    /\ live = {}
    /\ paused = FALSE
    /\ played = <<>>
    /\ wasted = 0
    /\ disruptions = 0
    /\ pauses = 0

\* Core announces the next spoken line while one plays (`Player.announceNext`).
Hint ==
    /\ ahead
    /\ current.phase = "playing"
    /\ next <= N
    /\ hinted # current.line
    /\ hint' = next
    /\ hinted' = current.line
    /\ UNCHANGED <<plan, next, config, ahead, last, current, prepared, live,
                   paused, played, wasted, disruptions, pauses>>

\* `lookaheadLine` may start the prepared request.
CanPrepare ==
    /\ ahead
    /\ hint # 0
    /\ prepared = {}
    /\ current.phase = "playing"
    /\ ~paused
    /\ live = {}

\* The request the next line will make if the playing line completes: its
\* previous text is the playing line (`SpeechContext.anticipate`).
StartPrepare ==
    /\ CanPrepare
    /\ prepared' = {[line |-> hint, key |-> Key(hint, config, current.line),
                     state |-> "flight"]}
    /\ live' = {"prepared"}
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hint, hinted,
                   paused, played, wasted, disruptions, pauses>>

PrepareSettles ==
    /\ "prepared" \in live
    /\ live' = live \ {"prepared"}
    /\ prepared' = {[p EXCEPT !.state = "ready"] : p \in prepared}
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hint, hinted,
                   paused, played, wasted, disruptions, pauses>>

\* A prepared request fails silently; the hint is spent, so it is not retried.
PrepareFails ==
    /\ "prepared" \in live
    /\ disruptions < MaxDisrupt
    /\ live' = live \ {"prepared"}
    /\ prepared' = {}
    /\ hint' = 0
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hinted, paused,
                   played, wasted, pauses>>

\* The line's own turn (`SpeechService.begin`): use the prepared line only if
\* its request is the one this line makes now; adopt it if still in flight;
\* otherwise discard it and wait for the slot.
Speak ==
    /\ current.line = 0
    /\ next <= N
    /\ LET e == Key(next, config, last)
           match == {p \in prepared : p.line = next /\ p.key = e}
       IN  IF match # {}
           THEN LET p == CHOOSE q \in match : TRUE
                    phase == IF p.state = "ready" THEN "ready" ELSE "requesting"
                IN  /\ current' = [line |-> next, phase |-> phase, key |-> e,
                                   used |-> p.key, early |-> TRUE]
                    /\ live' = IF "prepared" \in live
                               THEN (live \ {"prepared"}) \cup {"current"}
                               ELSE live
                    /\ wasted' = wasted
           ELSE /\ current' = [line |-> next, phase |-> "waiting", key |-> e,
                               used |-> NoKey, early |-> FALSE]
                /\ live' = IF "prepared" \in live
                           THEN (live \ {"prepared"}) \cup {"retired"}
                           ELSE live
                /\ wasted' = wasted + Cardinality(prepared)
    /\ prepared' = {}
    /\ next' = next + 1
    /\ hint' = 0
    /\ UNCHANGED <<plan, config, ahead, last, hinted, paused, played,
                   disruptions, pauses>>

\* The line makes its own request once the slot is free.
StartOwn ==
    /\ current.phase = "waiting"
    /\ live = {}
    /\ live' = {"current"}
    /\ current' = [current EXCEPT !.phase = "requesting", !.used = current.key]
    /\ UNCHANGED <<plan, next, config, ahead, last, hint, hinted, prepared,
                   paused, played, wasted, disruptions, pauses>>

OwnSettles ==
    /\ current.phase = "requesting"
    /\ "current" \in live
    /\ live' = live \ {"current"}
    /\ current' = [current EXCEPT !.phase = "ready"]
    /\ UNCHANGED <<plan, next, config, ahead, last, hint, hinted, prepared,
                   paused, played, wasted, disruptions, pauses>>

\* A discarded request's slot frees when its abort settles.
RetiredSettles ==
    /\ "retired" \in live
    /\ live' = live \ {"retired"}
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hint, hinted,
                   prepared, paused, played, wasted, disruptions, pauses>>

\* The audio starts: what it used is recorded with what was expected.
Started ==
    /\ current.phase = "ready"
    /\ ~paused
    /\ current' = [current EXCEPT !.phase = "playing"]
    /\ played' = Append(played, [line |-> current.line,
                                 used |-> current.used,
                                 expected |-> current.key,
                                 early |-> current.early])
    /\ UNCHANGED <<plan, next, config, ahead, last, hint, hinted, prepared,
                   live, paused, wasted, disruptions, pauses>>

\* The audio ends. The service starts a possible prepare in the same turn as
\* the start or the hint, so a line does not end while one could start.
Ended ==
    /\ current.phase = "playing"
    /\ ~(CanPrepare)
    /\ ~(ahead /\ next <= N /\ hinted # current.line)
    /\ last' = current.line
    /\ current' = NoLine
    /\ UNCHANGED <<plan, next, config, ahead, hint, hinted, prepared, live,
                   paused, played, wasted, disruptions, pauses>>

\* The line's own request fails: it is not played and does not become the
\* previous text.
LineFails ==
    /\ current.phase = "requesting"
    /\ "current" \in live
    /\ disruptions < MaxDisrupt
    /\ live' = live \ {"current"}
    /\ current' = NoLine
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<plan, next, config, ahead, last, hint, hinted, prepared,
                   paused, played, wasted, pauses>>

\* An interrupt, stop, reply, or session end: the rest of the plan is dropped,
\* and every request in flight is retired.
Cancel ==
    /\ disruptions < MaxDisrupt
    /\ current.line # 0 \/ prepared # {}
    /\ current' = NoLine
    /\ next' = N + 1
    /\ prepared' = {}
    /\ hint' = 0
    /\ wasted' = wasted + Cardinality(prepared)
    /\ live' = IF live = {} THEN {} ELSE {"retired"}
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<plan, config, ahead, last, hinted, paused, played, pauses>>

\* A settings change, the look-ahead setting included: speech is canceled and
\* the plan goes on with the new settings. Turning look-ahead off discards the
\* prepared line; another change may leave it, since only the request check at
\* the line's turn is relied on (a change the service does not see as one).
Configure ==
    /\ disruptions < MaxDisrupt
    /\ config < MaxConfig
    /\ config' = config + 1
    /\ ahead' \in BOOLEAN
    /\ current' = NoLine
    /\ \/ prepared' = {} /\ wasted' = wasted + Cardinality(prepared)
          /\ live' = IF live = {} THEN {} ELSE {"retired"}
       \/ ahead' /\ prepared' = prepared /\ wasted' = wasted
          /\ live' = IF "current" \in live THEN {"retired"} ELSE live
    /\ hint' = 0
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<plan, next, last, hinted, paused, played, pauses>>

\* The programmer stops the playing line: it does not become the previous
\* text, and the plan goes on. The prepared line may be left in place.
StopLine ==
    /\ disruptions < MaxDisrupt
    /\ current.phase = "playing"
    /\ current' = NoLine
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<plan, next, config, ahead, last, hint, hinted, prepared,
                   live, paused, played, wasted, pauses>>

\* The agent's next line turns out to say something else than was hinted.
Replan ==
    /\ disruptions < MaxDisrupt
    /\ next <= N
    /\ \E t \in Texts \ {plan[next]} : plan' = [plan EXCEPT ![next] = t]
    /\ disruptions' = disruptions + 1
    /\ UNCHANGED <<next, config, ahead, last, current, hint, hinted, prepared,
                   live, paused, played, wasted, pauses>>

Pause ==
    /\ ~paused
    /\ pauses < MaxPauses
    /\ paused' = TRUE
    /\ pauses' = pauses + 1
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hint, hinted,
                   prepared, live, played, wasted, disruptions>>

Resume ==
    /\ paused
    /\ paused' = FALSE
    /\ UNCHANGED <<plan, next, config, ahead, last, current, hint, hinted,
                   prepared, live, played, wasted, disruptions, pauses>>

\* Everything is spoken and settled.
Finished ==
    /\ next > N
    /\ current.line = 0
    /\ live = {}
    /\ UNCHANGED vars

Next ==
    \/ Hint \/ StartPrepare \/ PrepareSettles \/ PrepareFails \/ Speak
    \/ StartOwn \/ OwnSettles \/ RetiredSettles \/ Started \/ Ended
    \/ LineFails \/ Cancel \/ Configure \/ StopLine \/ Replan \/ Pause \/ Resume
    \/ Finished

Spec ==
    /\ Init /\ [][Next]_vars
    /\ WF_vars(Hint) /\ WF_vars(StartPrepare) /\ WF_vars(PrepareSettles)
    /\ WF_vars(Speak) /\ WF_vars(StartOwn) /\ WF_vars(OwnSettles)
    /\ WF_vars(RetiredSettles) /\ WF_vars(Started) /\ WF_vars(Ended)
    /\ WF_vars(Resume)

--------------------------------------------------------------------------------

\* What plays is what the line would have requested at its own turn.
PlayedAsRequested ==
    \A i \in 1..Len(played) : played[i].used = played[i].expected

\* One line ahead at most.
OneAhead == Cardinality(prepared) <= 1

\* One request in flight at a time: the decoder and the provider allow one.
SlotExclusive == Cardinality(live) <= 1

\* Lines play in the agent's order.
InOrder == \A i, j \in 1..Len(played) : i < j => played[i].line < played[j].line

\* With look-ahead off, nothing is prepared.
OffNothingAhead == ~ahead => prepared = {}

\* A prepared request is wasted only on a disruption.
BoundedWaste == wasted <= disruptions

\* Nothing is prepared while paused, or before the playing line is audible.
NoPrepareWhilePaused ==
    [][prepared = {} /\ prepared' # {} =>
           ~paused /\ current.phase = "playing"]_vars

\* Every line that is spoken finishes: played, failed, or canceled.
LineProgress == current.line # 0 ~> current.line = 0

\* Without a disruption or a pause, and with look-ahead on, a later line plays
\* from its prepared request: a look-ahead that never helps fails it.
AheadUsed ==
    <>(\/ disruptions > 0 \/ pauses > 0 \/ ~ahead \/ N < 2
       \/ \E i \in 1..Len(played) : played[i].early)

================================================================================
