---- MODULE WorkerDriver -------------------------------------------------------
EXTENDS Naturals, FiniteSets

\* This is the first driver slice: the main agent owns the session and can
\* converse independently of editing. Conversation and the contents of edits
\* are abstracted away. Tokens represent distinct worker tasks; the bounded
\* supply models delayed submissions from an earlier task. Queued-batch
\* admission and rehearsal are outside this slice.
CONSTANTS MaxTask, MaxBatch, GuardExclusive, GuardCurrent, GuardDrain,
          GuardAuthority, GuardRetire
VARIABLES enabled, issued, authority, slot, nextBatch, badSubmission,
          earlyGrant, badRetirement
vars == <<enabled, issued, authority, slot, nextBatch, badSubmission,
          earlyGrant, badRetirement>>

Tasks == 1..MaxTask
Owners == {"main", "worker"}
Batches == 1..MaxBatch
Occupied(owner) == \E batch \in slot: batch[1] = owner

Init ==
    /\ enabled = FALSE
    /\ issued = 0
    /\ authority = 0
    /\ slot = {}
    /\ nextBatch = 1
    /\ badRetirement = FALSE
    /\ badSubmission = FALSE
    /\ earlyGrant = FALSE

Enable ==
    /\ ~enabled
    /\ enabled' = TRUE
    /\ UNCHANGED <<issued, authority, slot, nextBatch, badSubmission,
                   earlyGrant, badRetirement>>

\* Both disabling and a programmer interruption revoke authority immediately.
\* They do not physically retire a batch already handed to playback.
Disable ==
    /\ enabled
    /\ enabled' = FALSE
    /\ authority' = 0
    /\ UNCHANGED <<issued, slot, nextBatch, badSubmission, earlyGrant,
                   badRetirement>>

Interrupt ==
    /\ authority # 0
    /\ authority' = 0
    /\ UNCHANGED <<enabled, issued, slot, nextBatch, badSubmission, earlyGrant,
                   badRetirement>>

Grant ==
    /\ enabled /\ authority = 0 /\ issued < MaxTask
    /\ GuardDrain => slot = {}
    /\ issued' = issued + 1
    /\ authority' = issued + 1
    /\ earlyGrant' = (earlyGrant \/ slot # {})
    /\ UNCHANGED <<enabled, slot, nextBatch, badSubmission, badRetirement>>

WorkerStart(task) ==
    /\ task \in Tasks /\ task <= issued
    /\ ~Occupied("worker")
    /\ nextBatch \in Batches
    /\ GuardExclusive => slot = {}
    /\ GuardCurrent => enabled /\ authority = task
    /\ slot' = slot \cup {<<"worker", nextBatch>>}
    /\ nextBatch' = nextBatch + 1
    /\ badSubmission' = (badSubmission \/ ~enabled \/ authority # task)
    /\ UNCHANGED <<enabled, issued, authority, earlyGrant, badRetirement>>

MainStart ==
    /\ ~Occupied("main")
    /\ nextBatch \in Batches
    /\ GuardAuthority => authority = 0
    /\ GuardExclusive => slot = {}
    /\ slot' = slot \cup {<<"main", nextBatch>>}
    /\ nextBatch' = nextBatch + 1
    /\ UNCHANGED <<enabled, issued, authority, badSubmission, earlyGrant,
                   badRetirement>>

Retire(owner, id) ==
    /\ owner \in Owners /\ id \in Batches
    /\ Occupied(owner) /\ id < nextBatch
    /\ GuardRetire => <<owner, id>> \in slot
    /\ badRetirement' = (badRetirement \/ <<owner, id>> \notin slot)
    /\ slot' = {batch \in slot: batch[1] # owner}
    /\ UNCHANGED <<enabled, issued, authority, nextBatch, badSubmission,
                   earlyGrant>>

Next == Enable \/ Disable \/ Interrupt \/ Grant \/ MainStart
        \/ (\E task \in Tasks: WorkerStart(task))
        \/ (\E owner \in Owners, id \in Batches: Retire(owner, id))

Spec == Init /\ [][Next]_vars
FairSpec == Spec /\ \A owner \in Owners, id \in Batches:
    WF_vars(Retire(owner, id))

TypeOK ==
    /\ enabled \in BOOLEAN
    /\ issued \in 0..MaxTask
    /\ authority \in 0..issued
    /\ slot \subseteq (Owners \X Batches)
    /\ nextBatch \in 1..(MaxBatch + 1)
    /\ badRetirement \in BOOLEAN
    /\ badSubmission \in BOOLEAN /\ earlyGrant \in BOOLEAN
Exclusive == Cardinality(slot) <= 1
MainRespectsGrant == Occupied("main") => authority = 0
CurrentOnly == ~badSubmission
DrainBeforeGrant == ~earlyGrant
MatchingRetirement == ~badRetirement
Retirement == \A owner \in Owners, id \in Batches:
    (<<owner, id>> \in slot) ~> (<<owner, id>> \notin slot)
================================================================================
