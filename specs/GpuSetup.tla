---- MODULE GpuSetup -----------------------------------------------------------
(***************************************************************************)
(* One bounded isolated GPU check and its selected narration backend.     *)
(***************************************************************************)
VARIABLES mode, phase, trusted, physical, negative, tiny, model, active,
          gpuReady, actual, retired
vars == <<mode, phase, trusted, physical, negative, tiny, model, active,
          gpuReady, actual, retired>>

TypeOK ==
    /\ mode \in {"cpu", "auto", "gpu"}
    /\ phase \in {"idle", "trust", "negative", "tiny", "model", "retire", "done"}
    /\ trusted \in BOOLEAN /\ physical \in BOOLEAN /\ negative \in BOOLEAN
    /\ tiny \in BOOLEAN /\ model \in BOOLEAN /\ active \in BOOLEAN
    /\ gpuReady \in BOOLEAN /\ actual \in {"none", "cpu", "gpu"}
    /\ retired \in BOOLEAN

Init ==
    /\ mode \in {"cpu", "auto", "gpu"} /\ phase = "idle"
    /\ trusted = FALSE /\ physical = FALSE /\ negative = FALSE
    /\ tiny = FALSE /\ model = FALSE /\ active = FALSE /\ gpuReady = FALSE
    /\ actual = "none" /\ retired = TRUE

Start ==
    /\ phase = "idle"
    /\ IF mode = "cpu" THEN /\ actual' = "cpu" /\ phase' = "done"
       ELSE /\ actual' = "none" /\ phase' = "trust"
    /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model, active, gpuReady, retired>>

Trust ==
    /\ phase = "trust" /\ trusted' \in BOOLEAN /\ physical' \in BOOLEAN
    /\ phase' = IF trusted' /\ physical' THEN "negative" ELSE "retire"
    /\ UNCHANGED <<mode, negative, tiny, model, active, gpuReady, actual, retired>>

Launch ==
    /\ phase \in {"negative", "tiny", "model"} /\ ~active /\ retired
    /\ active' = TRUE /\ retired' = FALSE
    /\ UNCHANGED <<mode, phase, trusted, physical, negative, tiny, model, gpuReady, actual>>

Result ==
    /\ phase \in {"negative", "tiny", "model"} /\ active
    /\ active' = FALSE /\ retired' = TRUE
    /\ CASE phase = "negative" ->
              /\ negative' \in BOOLEAN /\ phase' = IF negative' THEN "tiny" ELSE "retire"
              /\ UNCHANGED <<tiny, model>>
          [] phase = "tiny" ->
              /\ tiny' \in BOOLEAN /\ phase' = IF tiny' THEN "model" ELSE "retire"
              /\ UNCHANGED <<negative, model>>
          [] OTHER ->
              /\ model' \in BOOLEAN /\ phase' = IF model' THEN "done" ELSE "retire"
              /\ UNCHANGED <<negative, tiny>>
    /\ gpuReady' = (phase = "model" /\ model')
    /\ actual' = IF gpuReady' THEN "gpu" ELSE actual
    /\ UNCHANGED <<mode, trusted, physical>>

Timeout ==
    /\ phase \in {"negative", "tiny", "model"} /\ active
    /\ phase' = "retire" /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model,
                                         active, gpuReady, actual, retired>>

Retire ==
    /\ phase = "retire" /\ active' = FALSE /\ retired' = TRUE /\ phase' = "done"
    /\ actual' = IF mode = "auto" THEN "cpu" ELSE "none"
    /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model, gpuReady>>

Next == Start \/ Trust \/ Launch \/ Result \/ Timeout \/ Retire
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Trust) /\
        WF_vars(Launch) /\ WF_vars(Result) /\ WF_vars(Retire)
GpuVerified == gpuReady => (trusted /\ physical /\ negative /\ tiny /\ model /\ retired)
ExplicitNoFallback == mode = "gpu" => actual # "cpu"
NoSuccessorBeforeReap == active => ~retired
CheckSettles == (phase # "idle") ~> (phase = "done")
=============================================================================
