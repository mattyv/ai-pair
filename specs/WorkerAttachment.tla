---- MODULE WorkerAttachment ---------------------------------------------------
\* A worker gets one capability for one job and attachment. Tokens are
\* unforgeable opaque values: equality is the model's trust assumption. Both
\* attachments may reuse the same persistent session ID; generation identifies
\* their distinct owners. Wakeup after enqueue is modeled by BackgroundWorker.
EXTENDS Naturals

CONSTANTS AllowDisabled, CheckToken, RevokeGrant, ConsumeGrant, KeepOwner,
          HandleSubmission
ASSUME /\ AllowDisabled \in BOOLEAN
       /\ CheckToken \in BOOLEAN
       /\ RevokeGrant \in BOOLEAN
       /\ ConsumeGrant \in BOOLEAN
       /\ KeepOwner \in BOOLEAN
       /\ HandleSubmission \in BOOLEAN

Generations == {1, 2}
Tokens == {1, 2}
Jobs == {1, 2}
NoOwner == 0
NoGrant == 0

VARIABLES generation, owner, enabled, grant, used, queued, attempted
vars == <<generation, owner, enabled, grant, used, queued, attempted>>

Init == /\ generation = 1
        /\ owner = 1
        /\ enabled = [g \in Generations |-> FALSE]
        /\ grant = [g \in Generations |-> NoGrant]
        /\ used = {}
        /\ queued = [g \in Generations |-> 0]
        /\ attempted = {}

\* The attachment owner explicitly enables the capability before issuing it.
Enable == /\ owner = generation
          /\ enabled' = [enabled EXCEPT ![generation] = TRUE]
          /\ UNCHANGED <<generation, owner, grant, used, queued, attempted>>

\* Token and job are each uniquely associated with their attachment here.
Issue == /\ owner = generation
         /\ (enabled[generation] \/ AllowDisabled)
         /\ grant[generation] = NoGrant
         /\ grant' = [grant EXCEPT ![generation] = generation]
         /\ UNCHANGED <<generation, owner, enabled, used, queued, attempted>>

\* An authorized worker attempts submission while its attachment is live.
Attempt == /\ owner = generation
           /\ grant[generation] # NoGrant
           /\ generation \notin used
           /\ attempted' = attempted \cup {generation}
           /\ UNCHANGED <<generation, owner, enabled, grant, used, queued>>

\* A non-owner presents attachment, job and token. Only the current live
\* grant may be consumed. Bad inputs leave the state unchanged (rejection).
Publish(g, job, token) ==
    /\ HandleSubmission /\ owner # NoOwner
    /\ g \in attempted
    /\ IF CheckToken
       THEN /\ g = generation /\ job = g /\ token = grant[g]
            /\ grant[g] # NoGrant
       ELSE /\ g \in Generations /\ job \in Jobs /\ token \in Tokens
    /\ ~ConsumeGrant \/ g \notin used
    /\ queued[g] < 2
    /\ used' = used \cup {g}
    /\ queued' = [queued EXCEPT ![g] = @ + 1]
    /\ owner' = IF KeepOwner THEN owner ELSE NoOwner
    /\ UNCHANGED <<generation, enabled, grant, attempted>>

\* Disconnect revokes the current grant. Replacement attaches a new owner
\* under the same persistent session ID but a new generation.
Disconnect == /\ owner = generation
              /\ owner' = NoOwner
              /\ grant' = IF RevokeGrant
                           THEN [grant EXCEPT ![generation] = NoGrant]
                           ELSE grant
              /\ UNCHANGED <<generation, enabled, used, queued, attempted>>

Replace == /\ generation = 1 /\ owner = NoOwner
           /\ generation' = 2 /\ owner' = 2
           /\ UNCHANGED <<enabled, grant, used, queued, attempted>>

Next == \/ Enable \/ Issue \/ Attempt \/ Disconnect \/ Replace
        \/ \E g \in Generations, job \in Jobs, token \in Tokens :
             Publish(g, job, token)

\* A pending valid attempt is handled if its owner remains attached.
Fairness == \A g \in Generations : WF_vars(Publish(g, g, g))
Spec == Init /\ [][Next]_vars /\ Fairness

TypeOK == /\ generation \in Generations
          /\ owner \in Generations \cup {NoOwner}
          /\ enabled \in [Generations -> BOOLEAN]
          /\ grant \in [Generations -> Tokens \cup {NoGrant}]
          /\ used \subseteq Generations
          /\ attempted \subseteq Generations
          /\ queued \in [Generations -> 0..2]
OptIn == \A g \in Generations : grant[g] # NoGrant => enabled[g]
Revoked == \A g \in Generations :
             (g # generation \/ owner = NoOwner) => grant[g] = NoGrant
AtMostOnce == \A g \in Generations : queued[g] <= 1
\* A queue entry can only come from a valid grant of the current attachment.
CorrectGrant == \A g \in Generations :
                  queued[g] > 0 => /\ enabled[g] /\ g \in used
AcceptedMatches ==
    \A g \in Generations, job \in Jobs, token \in Tokens :
      [][Publish(g, job, token) =>
         /\ g = generation /\ job = g /\ token = grant[g]
         /\ grant[g] # NoGrant]_vars
SubmissionHandled == \A g \in Generations :
    (g \in attempted /\ g = owner /\ g \notin used) ~>
      (queued[g] > 0 \/ owner # g)
OwnerStable == [][(\E g \in Generations, job \in Jobs, token \in Tokens :
                    Publish(g, job, token)) => owner' = owner]_vars
================================================================================
