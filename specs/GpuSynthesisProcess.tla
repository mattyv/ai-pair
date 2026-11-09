---- MODULE GpuSynthesisProcess ------------------------------------------------
EXTENDS Naturals

\* A child process owns inference until exit. Proof is consumed at launch.
CONSTANTS GuardProof, GuardReap, GuardEpoch, GuardPlayback, GuardKill,
          GuardLoader
VARIABLES proof, phase, epoch, child, request, canceled, audio, fallback,
          killSent, badProof, overlap, stale, duplicate, loaderVerified
vars == <<proof, phase, epoch, child, request, canceled, audio, fallback,
          killSent, badProof, overlap, stale, duplicate, loaderVerified>>

Init ==
  /\ proof = FALSE /\ phase = "cold" /\ epoch = 0 /\ child = FALSE
  /\ request = FALSE /\ canceled = FALSE /\ audio = FALSE /\ fallback = FALSE
  /\ killSent = FALSE /\ badProof = FALSE /\ overlap = FALSE
  /\ stale = FALSE /\ duplicate = FALSE /\ loaderVerified = FALSE

Verify ==
  /\ ~proof /\ proof' = TRUE
  /\ UNCHANGED <<phase, epoch, child, request, canceled, audio, fallback,
                 killSent, badProof, overlap, stale, duplicate, loaderVerified>>

Spawn ==
  /\ epoch < 2 /\ phase = "cold" /\ (proof \/ ~GuardProof)
  /\ (~child \/ ~GuardReap)
  /\ epoch' = epoch + 1 /\ phase' = "loading" /\ child' = TRUE
  /\ badProof' = (badProof \/ ~proof) /\ overlap' = (overlap \/ child)
  /\ proof' = FALSE /\ canceled' = FALSE /\ killSent' = FALSE
  /\ loaderVerified' = FALSE
  /\ UNCHANGED <<request, audio, fallback, stale, duplicate>>

VerifyLoader ==
  /\ phase \in {"loading", "busy"} /\ ~loaderVerified
  /\ loaderVerified' = TRUE
  /\ UNCHANGED <<proof, phase, epoch, child, request, canceled, audio,
                 fallback, killSent, badProof, overlap, stale, duplicate>>

Ready(e) ==
  /\ phase = "loading" /\ e \in 1..2 /\ (e = epoch \/ ~GuardEpoch)
  /\ (loaderVerified \/ ~GuardLoader)
  /\ phase' = "ready"
  /\ badProof' = (badProof \/ ~loaderVerified)
  /\ stale' = (stale \/ e # epoch)
  /\ UNCHANGED <<proof, epoch, child, request, canceled, audio, fallback,
                 killSent, overlap, duplicate, loaderVerified>>

Dispatch ==
  /\ phase = "ready" /\ ~audio /\ ~fallback
  /\ phase' = "busy" /\ request' = TRUE /\ canceled' = FALSE
  /\ loaderVerified' = FALSE
  /\ UNCHANGED <<proof, epoch, child, audio, fallback, killSent, badProof,
                 overlap, stale, duplicate>>

Result(e) ==
  /\ phase = "busy" /\ request /\ e \in 1..2
  /\ (e = epoch \/ ~GuardEpoch) /\ ~canceled
  /\ (loaderVerified \/ ~GuardLoader)
  /\ phase' = "ready" /\ request' = FALSE /\ audio' = TRUE
  /\ stale' = (stale \/ e # epoch)
  /\ badProof' = (badProof \/ ~loaderVerified)
  /\ UNCHANGED <<proof, epoch, child, canceled, fallback, killSent,
                 overlap, duplicate, loaderVerified>>

Retire ==
  /\ phase \in {"loading", "ready", "busy"} /\ phase' = "retiring"
  /\ canceled' = TRUE /\ request' = FALSE
  /\ UNCHANGED <<proof, epoch, child, audio, fallback, killSent, badProof,
                 overlap, stale, duplicate, loaderVerified>>

Kill ==
  /\ phase = "retiring" /\ child /\ ~killSent /\ GuardKill
  /\ killSent' = TRUE
  /\ UNCHANGED <<proof, phase, epoch, child, request, canceled, audio,
                 fallback, badProof, overlap, stale, duplicate, loaderVerified>>

Exit ==
  /\ phase = "retiring" /\ child /\ killSent
  /\ child' = FALSE /\ phase' = "cold"
  /\ UNCHANGED <<proof, epoch, request, canceled, audio, fallback, killSent,
                 badProof, overlap, stale, duplicate, loaderVerified>>

GracefulExit ==
  /\ phase = "retiring" /\ child /\ ~killSent
  /\ child' = FALSE /\ phase' = "cold"
  /\ UNCHANGED <<proof, epoch, request, canceled, audio, fallback, killSent,
                 badProof, overlap, stale, duplicate, loaderVerified>>

Fallback ==
  /\ phase \in {"cold", "retiring"} /\ ~fallback
  /\ (~child \/ ~GuardReap) /\ (~audio \/ ~GuardPlayback)
  /\ fallback' = TRUE /\ duplicate' = (duplicate \/ audio)
  /\ overlap' = (overlap \/ child)
  /\ UNCHANGED <<proof, phase, epoch, child, request, canceled, audio,
                 killSent, badProof, stale, loaderVerified>>

Next == Verify \/ Spawn \/ VerifyLoader \/
        (\E e \in 1..2: Ready(e) \/ Result(e)) \/
        Dispatch \/ Retire \/ Kill \/ Exit \/ GracefulExit \/ Fallback
Spec == Init /\ [][Next]_vars /\ WF_vars(Kill) /\ WF_vars(Exit)
TypeOK == /\ proof \in BOOLEAN
          /\ phase \in {"cold", "loading", "ready", "busy", "retiring"}
          /\ epoch \in 0..2 /\ child \in BOOLEAN /\ request \in BOOLEAN
          /\ canceled \in BOOLEAN /\ audio \in BOOLEAN /\ fallback \in BOOLEAN
          /\ killSent \in BOOLEAN /\ badProof \in BOOLEAN /\ overlap \in BOOLEAN
          /\ stale \in BOOLEAN /\ duplicate \in BOOLEAN
          /\ loaderVerified \in BOOLEAN
Safe == ~badProof /\ ~overlap /\ ~stale /\ ~duplicate
RetirementProgress == (phase = "retiring") ~> (phase = "cold")
================================================================================
