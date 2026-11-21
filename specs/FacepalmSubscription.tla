---- MODULE FacepalmSubscription -----------------------------------------------
\* AI Pair's local subscription to Facepalm (github.com/mattyv/facepalm), a
\* standalone camera reaction service. Facepalm owns the camera and physical
\* retirement; this models only AI Pair's side: one subscription per session,
\* at most one beat open on it, and queued cues discarded, never delivered,
\* once retirement starts (ai-pair#83, item 14 of facepalm#61).
EXTENDS Integers

VARIABLES phase, pending, discardedPending, delivered, open

vars == <<phase, pending, discardedPending, delivered, open>>

Phases == {"closed", "connecting", "open", "beating", "retiring"}

Init ==
  /\ phase = "closed"
  /\ pending = 0
  /\ discardedPending = FALSE
  /\ delivered = 0
  /\ open = 0

\* Opt in, unmuted, in a session: AI Pair tries to subscribe. Guarded to the
\* retired "closed" phase, so a mute or session replacement never starts a
\* second subscription before the first one's retirement is confirmed.
Enable ==
  /\ phase = "closed"
  /\ phase' = "connecting"
  /\ UNCHANGED <<pending, discardedPending, delivered, open>>

\* Facepalm approved the "ai-pair" token (`facepalm-daemon approve ai-pair`).
Approve ==
  /\ phase = "connecting"
  /\ phase' = "open"
  /\ open' = open + 1
  /\ UNCHANGED <<pending, discardedPending, delivered>>

\* Facepalm is absent, or has not approved this name: the subscription stays
\* closed and nothing else changes (the acceptance guarantee: no error).
Refuse ==
  /\ phase = "connecting"
  /\ phase' = "closed"
  /\ UNCHANGED <<pending, discardedPending, delivered, open>>

\* The agent asked a question or proposed a change: mark a beat. At most one
\* beat is ever open on a subscription.
MarkBeat ==
  /\ phase = "open"
  /\ pending = 0
  /\ pending' = 1
  /\ phase' = "beating"
  /\ UNCHANGED <<discardedPending, delivered, open>>

\* Facepalm's reply reaches the pair report that opened the beat.
Answer ==
  /\ phase = "beating"
  /\ pending > 0
  /\ pending' = 0
  /\ phase' = "open"
  /\ delivered' = IF delivered < 2 THEN delivered + 1 ELSE delivered
  /\ UNCHANGED <<discardedPending, open>>

\* Mute, end, disable, or a session replacement: retirement starts. A beat
\* still open is discarded, never delivered, matching the camera's own
\* "cancellation does not mean retirement" (MANIFESTO.md).
Retire ==
  /\ phase \in {"open", "beating"}
  /\ phase' = "retiring"
  /\ discardedPending' = (discardedPending \/ (pending > 0))
  /\ pending' = 0
  /\ UNCHANGED <<delivered, open>>

\* The connection's close is confirmed: the subscription may be reused.
ConfirmRetired ==
  /\ phase = "retiring"
  /\ phase' = "closed"
  /\ open' = open - 1
  /\ UNCHANGED <<pending, discardedPending, delivered>>

Next ==
  Enable \/ Approve \/ Refuse \/ MarkBeat \/ Answer \/ Retire \/ ConfirmRetired

Spec == Init /\ [][Next]_vars /\ WF_vars(Answer) /\ WF_vars(ConfirmRetired)

TypeOK ==
  /\ phase \in Phases
  /\ pending \in 0..2
  /\ discardedPending \in BOOLEAN
  /\ delivered \in 0..2
  /\ open \in 0..2

\* One owner, one live subscription (MANIFESTO.md): never two open connections
\* at once, which `Enable`'s "closed" guard exists to prevent.
AtMostOneOpen == open <= 1

\* At most one beat outstanding on the subscription at a time.
OneBeatAtATime == pending <= 1

\* Retiring always clears a beat still open; nothing answers it afterwards.
PendingClearedOnRetire == phase = "retiring" => pending = 0

\* A marked beat is always eventually answered or retired away: it never
\* hangs forever (something must happen).
PendingAnswered == (pending > 0) ~> (pending = 0)

================================================================================
