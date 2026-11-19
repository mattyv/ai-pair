---- MODULE LocalAudioReconnect ------------------------------------------------
(***************************************************************************)
(* A remote window's connection to its AI Pair Local Audio companion can  *)
(* be lost when either extension host stalls past the acknowledgement     *)
(* bound (#127). Instead of giving up for good, the workspace retries the  *)
(* prepare and commit handshake with a new connection epoch, a bounded     *)
(* number of times, and warns only when every attempt has failed. The     *)
(* companion lets a prepare for a new epoch replace its attachment: it     *)
(* retires the old session and its panel provider first, so at most one   *)
(* provider is registered, and a frame of an old epoch is refused.         *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxAttempts, MaxLosses,
          GuardRetry, GuardRetire, GuardEpoch

\* epoch: the workspace's current connection epoch. state: "connected",
\* "lost", "reconnecting" (an attempt is in flight), or "failed" (gave up and
\* warned). attempts: retries since the last loss. losses: losses so far, a
\* bound only. attached: the epoch the companion is attached to, or 0.
\* providers: panel providers the companion has registered. stale: a frame
\* of an old epoch was accepted. warned: the programmer was told to reload.
VARIABLES epoch, state, attempts, losses, attached, providers, stale, warned
vars == <<epoch, state, attempts, losses, attached, providers, stale, warned>>

Init == /\ epoch = 1 /\ state = "connected" /\ attempts = 0 /\ losses = 0
        /\ attached = 1 /\ providers = 1 /\ stale = FALSE /\ warned = FALSE

\* A stall past the bound: the workspace gives up on the connection. The
\* companion may still be attached to it, or may lapse later. Without
\* GuardRetry, the old design: it warns at once and stays failed.
Lose ==
    /\ state = "connected" /\ losses < MaxLosses
    /\ losses' = losses + 1 /\ attempts' = 0
    /\ IF GuardRetry
         THEN /\ state' = "lost" /\ UNCHANGED warned
         ELSE /\ state' = "failed" /\ warned' = TRUE
    /\ UNCHANGED <<epoch, attached, providers, stale>>

\* The workspace starts an attempt with a new epoch.
Attempt ==
    /\ state = "lost" /\ attempts < MaxAttempts
    /\ epoch' = epoch + 1 /\ attempts' = attempts + 1
    /\ state' = "reconnecting"
    /\ UNCHANGED <<losses, attached, providers, stale, warned>>

\* The companion takes the prepare and commit for the new epoch: it retires
\* an attachment of another epoch, provider included, then registers anew.
\* Without GuardRetire it registers beside the old one.
Attach ==
    /\ state = "reconnecting" /\ attached # epoch
    /\ providers' = IF GuardRetire /\ attached # 0 THEN providers
                    ELSE providers + 1
    /\ attached' = epoch /\ state' = "connected"
    /\ UNCHANGED <<epoch, attempts, losses, stale, warned>>

\* An attempt fails: it timed out, or the companion did not answer. The
\* last allowed attempt warns.
AttemptFails ==
    /\ state = "reconnecting"
    /\ IF attempts = MaxAttempts
         THEN /\ state' = "failed" /\ warned' = TRUE
         ELSE /\ state' = "lost" /\ UNCHANGED warned
    /\ UNCHANGED <<epoch, attempts, losses, attached, providers, stale>>

\* A frame of an earlier epoch, delayed in the link, reaches the companion.
\* With GuardEpoch it is accepted only by an attachment of its own epoch;
\* without, by any attachment. (The companion's lease lapsing shuts its
\* session down but keeps the attachment, so it needs no action here.)
LateFrame ==
    /\ epoch > 1 /\ attached # 0
    /\ \E old \in 1..(epoch - 1) :
         stale' = (stale \/ (old # attached /\ ~GuardEpoch))
    /\ UNCHANGED <<epoch, state, attempts, losses, attached, providers, warned>>

Next == Lose \/ Attempt \/ Attach \/ AttemptFails \/ LateFrame

Spec == Init /\ [][Next]_vars /\ WF_vars(Attempt)
        /\ WF_vars(Attach \/ AttemptFails)

TypeOK ==
    /\ epoch \in 1..(1 + MaxLosses * MaxAttempts)
    /\ state \in {"connected", "lost", "reconnecting", "failed"}
    /\ attempts \in 0..MaxAttempts /\ losses \in 0..MaxLosses
    /\ attached \in 0..(1 + MaxLosses * MaxAttempts)
    /\ providers \in 0..(2 + MaxLosses * MaxAttempts)
    /\ stale \in BOOLEAN /\ warned \in BOOLEAN

\* At most one panel provider at a time.
SingleProvider == providers <= 1
\* A frame of an old epoch is never accepted.
NoStaleFrame == ~stale
\* The programmer is told to reload only after every attempt failed.
NoNeedlessWarning == warned => attempts = MaxAttempts
\* Something happens: a loss ends connected again, or warned.
LossSettles == (state = "lost") ~> (state \in {"connected", "failed"})
================================================================================
