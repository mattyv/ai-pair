---- MODULE SpeechLifecycle ----------------------------------------------------
EXTENDS Naturals, TLC
CONSTANTS MaxRequest, EnableProgress, GuardReap, GuardCurrent, GuardExplicit
Modes == {"cpu", "gpu", "auto"}
Phases == {"none", "proof", "loading", "ready", "retiring", "killed"}
Stages == {"proof", "cpu", "gpu", "failure"}
VARIABLES request, desired, pending, stage, phase, resource, resourceRequest,
          resourceKind, outcome, actual, disposed, closed, overlap, stale,
              fallback
vars == <<request, desired, pending, stage, phase, resource, resourceRequest,
          resourceKind, outcome, actual, disposed, closed, overlap, stale,
              fallback>>
Init == /\ request = 0 /\ desired = "cpu" /\ pending = FALSE
        /\ stage = "cpu" /\ phase = "none" /\ resource = <<0, "none">>
        /\ resourceRequest = 0 /\ resourceKind = "none" /\ outcome = "none"
        /\ actual = "none" /\ disposed = FALSE /\ closed = FALSE
        /\ overlap = FALSE /\ stale = FALSE /\ fallback = FALSE
\* Select and replacement cancellation each install the latest waiting request.
Select == /\ ~disposed /\ request < MaxRequest
          /\ desired' \in Modes /\ request' = request + 1 /\ pending' = TRUE
          /\ stage' = IF desired' = "cpu" THEN "cpu" ELSE "proof"
          /\ phase' = IF phase = "none" THEN "none" ELSE "retiring"
          /\ actual' = "none" /\ outcome' = "none"
          /\ UNCHANGED <<resource, resourceRequest, resourceKind, disposed,
              closed,
                         overlap, stale, fallback>>
Cancel == /\ ~disposed /\ pending /\ request < MaxRequest
          /\ request' = request + 1 /\ pending' = TRUE
          /\ stage' = IF desired = "cpu" THEN "cpu" ELSE "proof"
          /\ phase' = IF phase = "none" THEN "none" ELSE "retiring"
          /\ actual' = "none" /\ outcome' = "none"
          /\ UNCHANGED <<desired, resource, resourceRequest, resourceKind,
                         disposed, closed, overlap, stale, fallback>>
Launch == /\ ~disposed /\ pending /\ stage \in {"proof", "cpu", "gpu"}
          /\ (phase = "none" \/ ~GuardReap)
          /\ phase' = IF stage = "proof" THEN "proof" ELSE "loading"
          /\ resource' = <<request, IF stage = "proof" THEN "proof" ELSE
              "worker">>
          /\ resourceRequest' = request /\ resourceKind' = stage
          /\ overlap' = (overlap \/ phase # "none")
          /\ fallback' = (fallback \/ (desired = "gpu" /\ stage = "cpu"))
          /\ UNCHANGED <<request, desired, pending, stage, outcome, actual,
                         disposed, closed, stale>>
ProofResult == /\ phase = "proof" /\ resourceRequest = request
               /\ outcome' \in {"success", "failure"}
               /\ phase' = "retiring"
               /\ UNCHANGED <<request, desired, pending, stage, resource,
                              resourceRequest, resourceKind, actual, disposed,
                              closed, overlap, stale, fallback>>
Kill == /\ phase = "retiring" /\ phase' = "killed"
        /\ UNCHANGED <<request, desired, pending, stage, resource,
                       resourceRequest, resourceKind, outcome, actual, disposed,
                       closed, overlap, stale, fallback>>
Reap == /\ phase = "killed" /\ phase' = "none"
        /\ stage' = IF resourceRequest = request /\ resourceKind = "proof"
                        /\ outcome # "none"
                     THEN IF outcome = "success" THEN "gpu"
                          ELSE IF desired = "auto" \/ ~GuardExplicit THEN "cpu"
                          ELSE "failure"
                     ELSE stage
        /\ outcome' = "none"
        /\ UNCHANGED <<request, desired, pending, resource, resourceRequest,
                       resourceKind, actual, disposed, closed, overlap, stale,
                       fallback>>
LoadFailure == /\ phase = "loading" /\ resourceRequest = request
               /\ phase' = "retiring" /\ outcome' = "failure"
               /\ stage' = "failure"
               /\ UNCHANGED <<request, desired, pending, resource,
                   resourceRequest,
                              resourceKind, actual, disposed, closed, overlap,
                              stale, fallback>>
LoadResult == /\ phase = "loading" /\ (resourceRequest = request \/
                                        ~GuardCurrent)
              /\ phase' = "ready" /\ pending' = FALSE /\ actual' = resourceKind
              /\ stale' = (stale \/ resourceRequest # request)
              /\ UNCHANGED <<request, desired, stage, resource, resourceRequest,
                             resourceKind, outcome, disposed, closed, overlap,
                             fallback>>
Fail == /\ ~disposed /\ pending /\ stage = "failure" /\ phase = "none"
        /\ pending' = FALSE /\ actual' = "unavailable"
        /\ UNCHANGED <<request, desired, stage, phase, resource,
            resourceRequest,
                       resourceKind, outcome, disposed, closed, overlap, stale,
                       fallback>>
Dispose == /\ ~disposed /\ disposed' = TRUE /\ pending' = FALSE
           /\ phase' = IF phase = "none" THEN "none" ELSE "retiring"
           /\ actual' = "none" /\ outcome' = "none"
           /\ UNCHANGED <<request, desired, stage, resource, resourceRequest,
                          resourceKind, closed, overlap, stale, fallback>>
Close == /\ disposed /\ phase = "none" /\ ~closed /\ closed' = TRUE
         /\ UNCHANGED <<request, desired, pending, stage, phase, resource,
                        resourceRequest, resourceKind, outcome, actual,
                            disposed,
                        overlap, stale, fallback>>
\* Model stale callbacks as attempted completions; the currentness guard blocks
\* them.
StaleCallback == /\ phase \in {"retiring", "killed"} /\ resourceRequest #
                                                       request
                 /\ ~GuardCurrent /\ stale' = TRUE
                 /\ UNCHANGED <<request, desired, pending, stage, phase,
                     resource,
                                resourceRequest, resourceKind, outcome, actual,
                                disposed, closed, overlap, fallback>>
Drive == /\ EnableProgress /\ (Launch \/ ProofResult \/ Kill \/ Reap \/
                              LoadFailure \/ LoadResult \/ Fail \/ Close)
Next == Select \/ Cancel \/ Dispose \/ StaleCallback \/ Drive
Spec == Init /\ [][Next]_vars /\ WF_vars(Drive)
TypeOK == /\ request \in 0..MaxRequest /\ desired \in Modes /\ pending \in
                                                                 BOOLEAN
          /\ stage \in Stages /\ phase \in Phases
          /\ resource \in (0..MaxRequest) \X {"none", "proof", "worker"}
          /\ resourceRequest \in 0..MaxRequest
          /\ resourceKind \in {"none", "proof", "cpu", "gpu"}
          /\ outcome \in {"none", "success", "failure"}
          /\ actual \in {"none", "cpu", "gpu", "unavailable"}
          /\ disposed \in BOOLEAN /\ closed \in BOOLEAN /\ overlap \in BOOLEAN
          /\ stale \in BOOLEAN /\ fallback \in BOOLEAN
Safety == /\ ~overlap /\ ~stale /\ ~fallback
          /\ (closed => disposed /\ phase = "none")
          /\ (actual \in {"cpu", "gpu"} => phase = "ready" /\ resourceRequest =
                                            request /\ ~disposed)
          /\ (phase # "none" => resourceRequest > 0)
          /\ (disposed => ~pending /\ actual = "none")
LatestProgress == \A i \in 1..MaxRequest :
  (pending /\ request = i) ~> (~pending \/ request # i \/ disposed)
DisposeProgress == disposed ~> closed
================================================================================
