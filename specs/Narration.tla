---- MODULE Narration ----------------------------------------------------------
(******************************************************************************)
(* Selected narration has one outstanding unit and two independent gates.   *)
(******************************************************************************)
EXTENDS Naturals

VARIABLES outstanding, queued, active, accepted, displayed, token, pageEpoch,
          sessionEpoch, ready, resultId, resultPage, resultSession, reading,
          held, paused, speech, page, session, command, advanced, mode
vars == <<outstanding, queued, active, accepted, displayed, token, pageEpoch,
          sessionEpoch, ready, resultId, resultPage, resultSession, reading,
          held, paused, speech, page, session, command, advanced, mode>>

TypeOK ==
    /\ outstanding \in 0..1 /\ queued \in BOOLEAN /\ active \in BOOLEAN
    /\ accepted \in 0..2 /\ displayed \in BOOLEAN /\ token \in 0..2
    /\ pageEpoch \in 1..2 /\ sessionEpoch \in 1..2 /\ ready \in BOOLEAN
    /\ resultId \in 0..2 /\ resultPage \in 0..2 /\ resultSession \in 0..2
    /\ reading \in {"idle", "waiting", "done"} /\ held \in BOOLEAN
    /\ paused \in BOOLEAN /\ speech \in {"idle", "preparing", "playing",
                                        "paused", "done", "canceled"}
    /\ page \in BOOLEAN /\ session \in BOOLEAN /\ advanced \in BOOLEAN
    /\ command \in {"pending", "approved"}
    /\ mode \in {"live", "rehearsal", "replay"}

Init ==
    /\ outstanding = 0 /\ queued = FALSE /\ active = FALSE /\ accepted = 0
    /\ displayed = FALSE /\ token = 0 /\ pageEpoch = 1 /\ sessionEpoch = 1
    /\ ready = FALSE /\ resultId = 0 /\ resultPage = 0 /\ resultSession = 0
    /\ reading = "idle" /\ held = FALSE /\ paused = FALSE /\ speech = "idle"
    /\ page = TRUE /\ session = TRUE /\ command = "pending"
    /\ advanced = FALSE /\ mode = "live"

Admit ==
    /\ session /\ outstanding = 0 /\ accepted < 2
    /\ outstanding' = outstanding + 1 /\ queued' = TRUE
    /\ accepted' = accepted + 1
    /\ UNCHANGED <<active, displayed, token, pageEpoch, sessionEpoch, ready,
                   resultId, resultPage, resultSession, reading, held, paused,
                   speech, page, session, command, advanced, mode>>
Display ==
    /\ session /\ queued /\ ~active
    /\ queued' = FALSE /\ active' = TRUE /\ displayed' = TRUE
    /\ token' = token + 1 /\ reading' = "waiting" /\ held' = FALSE
    /\ ready' = FALSE /\ advanced' = FALSE
    /\ speech' = IF mode = "live" /\ page THEN "preparing" ELSE "done"
    /\ UNCHANGED <<outstanding, accepted, pageEpoch, sessionEpoch, resultId,
                   resultPage, resultSession, paused, page, session,
                   command, mode>>
Ready(id, pg, sess) ==
    /\ speech = "preparing" /\ ~ready /\ page /\ session
    /\ id = token /\ pg = pageEpoch /\ sess = sessionEpoch
    /\ ready' = TRUE /\ resultId' = id /\ resultPage' = pg
    /\ resultSession' = sess
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, reading, held, paused, speech, page,
                   session, command, advanced, mode>>
StartSpeech ==
    /\ speech = "preparing" /\ ready /\ ~paused /\ page /\ session
    /\ speech' = "playing"
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, held, paused, page, session, command,
                   advanced, mode>>
SpeechEnded(id, pg, sess) ==
    /\ speech = "playing" /\ id = token /\ pg = pageEpoch
    /\ sess = sessionEpoch /\ page /\ session
    /\ speech' = "done" /\ resultId' = id /\ resultPage' = pg
    /\ resultSession' = sess
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, reading, held, paused, page,
                   session, command, advanced, mode>>
SpeechError(id, pg, sess) ==
    /\ speech \in {"preparing", "playing", "paused"}
    /\ id = token /\ pg = pageEpoch /\ sess = sessionEpoch /\ page /\ session
    /\ speech' = "done" /\ resultId' = id /\ resultPage' = pg
    /\ resultSession' = sess
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, reading, held, paused, page,
                   session, command, advanced, mode>>
FinishReading ==
    /\ reading = "waiting" /\ ~paused /\ ~held /\ reading' = "done"
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, held, paused, speech, page, session, command,
                   advanced, mode>>
Hold ==
    /\ reading = "waiting" /\ ~held /\ held' = TRUE
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, paused, speech, page, session,
                   command, advanced, mode>>
Release ==
    /\ held /\ held' = FALSE
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, paused, speech, page, session,
                   command, advanced, mode>>
Pause ==
    /\ ~paused /\ paused' = TRUE
    /\ speech' = IF speech = "playing" THEN "paused" ELSE speech
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, held, page, session, command,
                   advanced, mode>>
Resume ==
    /\ paused /\ paused' = FALSE
    /\ speech' = IF speech = "paused" THEN "playing" ELSE speech
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, held, page, session, command,
                   advanced, mode>>
Cancel ==
    /\ speech \in {"preparing", "playing", "paused"} /\ speech' = "canceled"
    /\ ready' = FALSE
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, resultId, resultPage, resultSession,
                   reading, held, paused, page, session, command, advanced,
                   mode>>
Reply ==
    /\ session /\ session' = FALSE /\ outstanding' = 0
    /\ queued' = FALSE /\ active' = FALSE /\ ready' = FALSE
    /\ speech' = IF speech \in {"preparing", "playing", "paused"}
                 THEN "canceled" ELSE speech
    /\ UNCHANGED <<accepted, displayed, token, pageEpoch, sessionEpoch,
                   resultId,
                   resultPage, resultSession, reading, held, paused, page,
                   command, advanced, mode>>
NewSession ==
    /\ ~session /\ sessionEpoch < 2 /\ session' = TRUE
    /\ sessionEpoch' = sessionEpoch + 1 /\ displayed' = FALSE
    /\ speech' = "idle" /\ reading' = "idle" /\ held' = FALSE
    /\ advanced' = FALSE
    /\ UNCHANGED <<outstanding, queued, active, accepted, token, pageEpoch,
                   ready, resultId, resultPage, resultSession, paused, page,
                   command, mode>>
LosePage ==
    /\ page /\ page' = FALSE /\ ready' = FALSE
    /\ speech' = IF speech \in {"preparing", "playing", "paused"}
                 THEN "canceled" ELSE speech
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, resultId, resultPage, resultSession,
                   reading, held, paused, session, command, advanced, mode>>
RestorePage ==
    /\ ~page /\ pageEpoch < 2 /\ page' = TRUE /\ pageEpoch' = pageEpoch + 1
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   sessionEpoch, ready, resultId, resultPage, resultSession,
                   reading, held, paused, speech, session, command,
                   advanced, mode>>
Advance ==
    /\ active /\ reading = "done" /\ speech \in {"done", "canceled"}
    /\ ~paused /\ ~held /\ session /\ outstanding' = outstanding - 1
    /\ active' = FALSE /\ advanced' = TRUE
    /\ UNCHANGED <<queued, accepted, displayed, token, pageEpoch, sessionEpoch,
                   ready, resultId, resultPage, resultSession, reading, held,
                   paused, speech, page, session, command, mode>>
Approve ==
    /\ command = "pending" /\ command' = "approved"
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, held, paused, speech, page, session,
                   advanced, mode>>
ChooseMode ==
    /\ accepted = 0 /\ outstanding = 0 /\ mode' \in {"rehearsal", "replay"}
    /\ UNCHANGED <<outstanding, queued, active, accepted, displayed, token,
                   pageEpoch, sessionEpoch, ready, resultId, resultPage,
                   resultSession, reading, held, paused, speech, page, session,
                   command, advanced>>
Next == Admit \/ Display \/ StartSpeech \/ FinishReading \/ Hold \/ Release \/
        Pause \/ Resume \/ Cancel \/ Reply \/ NewSession \/ LosePage \/
        RestorePage \/ Advance \/ Approve \/ ChooseMode \/
        (\E id \in 1..2, pg \in 1..2, sess \in 1..2 :
            Ready(id, pg, sess) \/ SpeechEnded(id, pg, sess) \/
            SpeechError(id, pg, sess))
Spec == Init /\ [][Next]_vars
ProgressSpec == Spec /\ WF_vars(StartSpeech) /\ WF_vars(FinishReading) /\
    WF_vars(Advance) /\ (\A id \in 1..2, pg \in 1..2, sess \in 1..2 :
        WF_vars(Ready(id, pg, sess)) /\ WF_vars(SpeechEnded(id, pg, sess)))
Progress == (<>[](~paused /\ ~held /\ page /\ session)) =>
            [](active => <>~active)
GateSafe ==
    [][(speech \in {"preparing", "playing", "paused"} /\
       speech' \in {"done", "canceled"}) =>
       /\ reading' = reading /\ held' = held /\ paused' = paused
       /\ command' = command]_vars
ReadyCurrent == ready => resultId = token /\ resultPage = pageEpoch /\
                         resultSession = sessionEpoch
CompletionCurrent ==
    [][(speech \in {"preparing", "playing", "paused"} /\ speech' = "done") =>
       /\ resultId' = token /\ resultPage' = pageEpoch
       /\ resultSession' = sessionEpoch]_vars
Ownership == outstanding = (IF queued THEN 1 ELSE 0) +
                           (IF active THEN 1 ELSE 0)
DisplayedBeforeSpeech ==
    speech \in {"preparing", "playing", "paused"} => displayed
LiveOnly == speech \in {"preparing", "playing", "paused"} => mode = "live"
PlayingHasReady == speech = "playing" => ready
NoPlayingWhilePaused == paused => speech # "playing"
AdvanceAfterGates ==
    advanced => reading = "done" /\ speech \in {"done", "canceled"}
NoAudioWithoutPage == ~page => speech \notin {"preparing", "playing", "paused"}
NoAudioWithoutSession ==
    ~session => speech \notin {"preparing", "playing", "paused"}
================================================================================
