---- MODULE ReplyReport --------------------------------------------------------
(***************************************************************************)
(* A reply from the panel records the programmer's message and ends every *)
(* pause (specs/Draft.tla, ResumeAll). An agent waiting in `listen` is    *)
(* answered with the message at once, so the report must say what holds  *)
(* once the reply is done: never paused (#125). The old design answered  *)
(* between recording the message and ending the pauses, so the report    *)
(* said playback was paused, and the agent waited for nothing.           *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxSends, GuardOrder

\* paused: some pause reason holds. listening: the agent's `listen` waits.
\* queued: a message the agent has not been given. report: what the agent
\* holds, if anything: whether it carries a message, whether a reply built it,
\* and whether it says playback is paused. phase: "idle", or "recorded" while
\* the old design's reply has recorded the message but not yet resumed.
VARIABLES paused, listening, queued, report, phase, sends
vars == <<paused, listening, queued, report, phase, sends>>

NoReport == [msg |-> FALSE, reply |-> FALSE, paused |-> FALSE, none |-> TRUE]
Report(msg, reply, isPaused) ==
    [msg |-> msg, reply |-> reply, paused |-> isPaused, none |-> FALSE]

Init == /\ paused = FALSE /\ listening = FALSE /\ queued = FALSE
        /\ report = NoReport /\ phase = "idle" /\ sends = 0

\* Typing in the reply box, Pause, looking away: any pause reason.
Pause ==
    /\ phase = "idle" /\ ~paused /\ paused' = TRUE
    /\ UNCHANGED <<listening, queued, report, sends, phase>>

\* The agent calls `listen` while it holds no report; one with a message
\* waiting is answered at once, with the pause as it stands.
Listen ==
    /\ phase = "idle" /\ ~listening /\ report.none
    /\ IF queued
         THEN /\ report' = Report(TRUE, FALSE, paused) /\ queued' = FALSE
              /\ UNCHANGED listening
         ELSE /\ listening' = TRUE /\ UNCHANGED <<report, queued>>
    /\ UNCHANGED <<paused, phase, sends>>

\* A reply. With GuardOrder, the pauses end before the message is recorded,
\* so an agent already listening is answered with what holds afterwards.
\* Without it, the old order: the message first, answering a waiting agent
\* with the pause still standing, and the pauses end in a second step.
SendReply ==
    /\ phase = "idle" /\ sends < MaxSends
    /\ sends' = sends + 1
    /\ LET after == IF GuardOrder THEN FALSE ELSE paused IN
         IF listening
           THEN /\ report' = Report(TRUE, TRUE, after)
                /\ listening' = FALSE /\ UNCHANGED queued
           ELSE /\ queued' = TRUE /\ UNCHANGED <<report, listening>>
    /\ IF GuardOrder
         THEN /\ paused' = FALSE /\ UNCHANGED phase
         ELSE /\ phase' = "recorded" /\ UNCHANGED paused

\* The old order's second step: resume() ends the pauses.
ResumeAfter ==
    /\ phase = "recorded" /\ phase' = "idle" /\ paused' = FALSE
    /\ UNCHANGED <<listening, queued, report, sends>>

\* The agent reads its report and acts on it.
Take ==
    /\ ~report.none /\ report' = NoReport
    /\ UNCHANGED <<paused, listening, queued, phase, sends>>

Next == Pause \/ Listen \/ SendReply \/ ResumeAfter \/ Take

Spec == Init /\ [][Next]_vars /\ WF_vars(Listen) /\ WF_vars(Take)
        /\ WF_vars(ResumeAfter)

TypeOK ==
    /\ paused \in BOOLEAN /\ listening \in BOOLEAN /\ queued \in BOOLEAN
    /\ phase \in {"idle", "recorded"} /\ sends \in 0..MaxSends

\* A report a reply built never says playback is paused: the reply ended
\* every pause.
NoPausedReply == report.reply => ~report.paused
\* Something happens: a reply sent reaches the agent.
ReplyReaches == queued ~> (~queued /\ report.msg)
================================================================================
