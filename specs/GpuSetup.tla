---- MODULE GpuSetup -----------------------------------------------------------
(***************************************************************************)
(* One bounded isolated GPU check and its selected narration backend.     *)
(***************************************************************************)
VARIABLES mode, phase, trusted, physical, negative, tiny, model, active,
          gpuReady, actual, retired, downloaded, driverMapped, noDriver, symlinkSafe
vars == <<mode, phase, trusted, physical, negative, tiny, model, active,
          gpuReady, actual, retired, downloaded, driverMapped, noDriver, symlinkSafe>>

TypeOK ==
    /\ mode \in {"cpu", "auto", "gpu"}
    /\ phase \in {"idle", "trust", "download", "negative", "tiny", "model", "retire", "done"}
    /\ trusted \in BOOLEAN /\ physical \in BOOLEAN /\ negative \in BOOLEAN
    /\ tiny \in BOOLEAN /\ model \in BOOLEAN /\ active \in BOOLEAN
    /\ gpuReady \in BOOLEAN /\ actual \in {"none", "cpu", "gpu"}
    /\ retired \in BOOLEAN /\ downloaded \in BOOLEAN
    /\ driverMapped \in BOOLEAN /\ noDriver \in BOOLEAN /\ symlinkSafe \in BOOLEAN

Init ==
    /\ mode \in {"cpu", "auto", "gpu"} /\ phase = "idle"
    /\ trusted = FALSE /\ physical = FALSE /\ negative = FALSE
    /\ tiny = FALSE /\ model = FALSE /\ active = FALSE /\ gpuReady = FALSE
    /\ actual = "none" /\ retired = TRUE /\ downloaded = FALSE
    /\ driverMapped = FALSE /\ noDriver = FALSE /\ symlinkSafe = FALSE

Start ==
    /\ phase = "idle"
    /\ IF mode = "cpu" THEN /\ actual' = "cpu" /\ phase' = "done"
       ELSE /\ actual' = "none" /\ phase' = "trust"
    /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model, active, gpuReady, retired, downloaded, driverMapped, noDriver, symlinkSafe>>

Trust ==
    /\ phase = "trust" /\ trusted' \in BOOLEAN /\ physical' \in BOOLEAN /\ symlinkSafe' \in BOOLEAN
    /\ phase' = IF trusted' /\ physical' /\ symlinkSafe' THEN "download" ELSE "retire"
    /\ UNCHANGED <<mode, negative, tiny, model, active, gpuReady, actual, retired, downloaded, driverMapped, noDriver>>

Download ==
    /\ phase = "download" /\ downloaded' \in BOOLEAN
    /\ phase' = IF downloaded' THEN "negative" ELSE "retire"
    /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model, active,
                   gpuReady, actual, retired, driverMapped, noDriver, symlinkSafe>>

Launch ==
    /\ phase \in {"negative", "tiny", "model"} /\ ~active /\ retired
    /\ active' = TRUE /\ retired' = FALSE
    /\ UNCHANGED <<mode, phase, trusted, physical, negative, tiny, model, gpuReady, actual, downloaded, driverMapped, noDriver, symlinkSafe>>

Result ==
    /\ phase \in {"negative", "tiny", "model"} /\ active
    /\ active' = FALSE /\ retired' = TRUE
    /\ CASE phase = "negative" ->
              /\ noDriver' \in BOOLEAN /\ negative' = noDriver'
              /\ phase' = IF negative' THEN "tiny" ELSE "retire"
              /\ UNCHANGED <<tiny, model, driverMapped>>
          [] phase = "tiny" ->
              /\ driverMapped' \in BOOLEAN /\ tiny' = driverMapped'
              /\ phase' = IF tiny' THEN "model" ELSE "retire"
              /\ UNCHANGED <<negative, model, noDriver>>
          [] OTHER ->
              /\ driverMapped' \in BOOLEAN /\ model' = driverMapped'
              /\ phase' = IF model' THEN "done" ELSE "retire"
              /\ UNCHANGED <<negative, tiny, noDriver>>
    /\ gpuReady' = (phase = "model" /\ model')
    /\ actual' = IF gpuReady' THEN "gpu" ELSE actual
    /\ UNCHANGED <<mode, trusted, physical, downloaded, symlinkSafe>>

Timeout ==
    /\ phase \in {"negative", "tiny", "model"} /\ active
    /\ phase' = "retire" /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model,
                                         active, gpuReady, actual, retired, downloaded, driverMapped, noDriver, symlinkSafe>>

Retire ==
    /\ phase = "retire" /\ active' = FALSE /\ retired' = TRUE /\ phase' = "done"
    /\ actual' = IF mode = "auto" THEN "cpu" ELSE "none"
    /\ UNCHANGED <<mode, trusted, physical, negative, tiny, model, gpuReady, downloaded, driverMapped, noDriver, symlinkSafe>>

Next == Start \/ Trust \/ Download \/ Launch \/ Result \/ Timeout \/ Retire
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Trust) /\
        WF_vars(Download) /\ WF_vars(Launch) /\ WF_vars(Result) /\ WF_vars(Retire)
GpuVerified == gpuReady => (trusted /\ physical /\ downloaded /\ negative /\ tiny /\ model /\ retired)
TrustedSymlinkChain == phase = "download" => symlinkSafe
DriverIdentity == gpuReady => (driverMapped /\ noDriver)
PreflightBeforeDownload == phase = "download" => (trusted /\ physical)
ExplicitNoFallback == mode = "gpu" => actual # "cpu"
NoSuccessorBeforeReap == active => ~retired
CheckSettles == (phase # "idle") ~> (phase = "done")
=============================================================================
