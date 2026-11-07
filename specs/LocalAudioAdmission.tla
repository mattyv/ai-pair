---- MODULE LocalAudioAdmission ------------------------------------------------
(***************************************************************************
 * Two speech units, page epochs, capability checks and device snapshots. *
 * A missing named device cannot be replaced by the default route.        *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardCapability, GuardAdmission, GuardCloud, GuardTarget, GuardRelease

VARIABLES generation, page, requestPage, selected, snapshot, capability,
          available, connected, phase, actual, badCapability, badAdmission,
          badCloud, reserved
vars == <<generation, page, requestPage, selected, snapshot, capability,
          available, connected, phase, actual, badCapability, badAdmission,
          badCloud, reserved>>

Init ==
    /\ generation = 0 /\ page = 0 /\ requestPage = 0
    /\ selected = "default" /\ snapshot = "default"
    /\ capability = TRUE /\ available = TRUE /\ connected = TRUE
    /\ phase = "idle" /\ actual = "none"
    /\ badCapability = FALSE /\ badAdmission = FALSE /\ badCloud = FALSE
    /\ reserved = FALSE

Begin ==
    /\ phase = "idle" /\ generation < 2 /\ connected
    /\ generation' = generation + 1 /\ requestPage' = page
    /\ snapshot' = selected /\ phase' = "checking" /\ actual' = "none"
    /\ reserved' = TRUE
    /\ UNCHANGED <<page, selected, capability, available, connected,
                   badCapability, badAdmission, badCloud>>

Advertise(claim) ==
    /\ claim \in BOOLEAN /\ (~GuardCapability \/ claim = capability)
    /\ badCapability' = (badCapability \/ (claim /\ ~capability))
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, connected, phase, actual,
                   badAdmission, badCloud, reserved>>

Admit ==
    /\ phase = "checking"
    /\ (~GuardAdmission \/ (capability /\ connected /\ requestPage = page /\
                             (snapshot = "default" \/ available)))
    /\ badAdmission' = (badAdmission \/ ~capability \/ ~connected \/
                        requestPage # page \/
                        (snapshot # "default" /\ ~available))
    /\ phase' = "admitted"
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, connected, actual,
                   badCapability, badCloud, reserved>>

SendCloud ==
    /\ (~GuardCloud \/ phase = "admitted") /\ connected
    /\ phase \in {"checking", "admitted"}
    /\ badCloud' = (badCloud \/ phase # "admitted" \/ requestPage # page)
    /\ phase' = "cloud"
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, connected, actual,
                   badCapability, badAdmission, reserved>>

Play ==
    /\ phase \in {"admitted", "cloud"} /\ connected /\ requestPage = page
    /\ snapshot = "default" \/ available
    /\ actual' \in IF GuardTarget THEN {snapshot} ELSE {"default", "device"}
    /\ phase' = "playing"
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, connected, badCapability,
                   badAdmission, badCloud, reserved>>

Finish ==
    /\ phase # "idle" /\ phase' = "idle" /\ actual' = "none"
    /\ reserved' = IF GuardRelease THEN FALSE ELSE reserved
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, connected, badCapability,
                   badAdmission, badCloud>>

ChangePage ==
    /\ page < 2 /\ page' = page + 1 /\ phase' = "idle" /\ actual' = "none"
    /\ reserved' = IF GuardRelease THEN FALSE ELSE reserved
    /\ UNCHANGED <<generation, requestPage, selected, snapshot, capability,
                   available, connected, badCapability, badAdmission, badCloud>>

Select ==
    /\ phase = "idle" /\ selected' \in {"default", "device"}
    /\ UNCHANGED <<generation, page, requestPage, snapshot, capability,
                   available, connected, phase, actual, badCapability,
                   badAdmission, badCloud, reserved>>

ChangeCapability ==
    /\ capability' = ~capability
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   available, connected, phase, actual, badCapability,
                   badAdmission, badCloud, reserved>>

ChangeAvailability ==
    /\ available' = ~available
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, connected, phase, actual, badCapability,
                   badAdmission, badCloud, reserved>>

Disconnect ==
    /\ connected /\ connected' = FALSE /\ phase' = "idle" /\ actual' = "none"
    /\ reserved' = IF GuardRelease THEN FALSE ELSE reserved
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, badCapability, badAdmission,
                   badCloud>>

Reconnect ==
    /\ ~connected /\ connected' = TRUE
    /\ UNCHANGED <<generation, page, requestPage, selected, snapshot,
                   capability, available, phase, actual, badCapability,
                   badAdmission, badCloud, reserved>>

Next == Begin \/ (\E claim \in BOOLEAN: Advertise(claim)) \/ Admit
        \/ SendCloud \/ Play \/ Finish \/ ChangePage \/ Select
        \/ ChangeCapability \/ ChangeAvailability \/ Disconnect \/ Reconnect
Spec == Init /\ [][Next]_vars
TypeOK ==
    /\ generation \in 0..2 /\ page \in 0..2 /\ requestPage \in 0..2
    /\ selected \in {"default", "device"} /\ snapshot \in {"default", "device"}
    /\ capability \in BOOLEAN /\ available \in BOOLEAN /\ connected \in BOOLEAN
    /\ phase \in {"idle", "checking", "admitted", "cloud", "playing"}
    /\ actual \in {"none", "default", "device"}
    /\ reserved \in BOOLEAN
    /\ badCapability \in BOOLEAN /\ badAdmission \in BOOLEAN
    /\ badCloud \in BOOLEAN
NoAbandonedReservation == phase = "idle" => ~reserved
TruthfulCapability == ~badCapability
SafeAdmission == ~badAdmission
CloudAfterAdmission == ~badCloud
NoFallback == phase = "playing" => actual = snapshot
CanBegin == (phase = "idle" /\ generation < 2 /\ connected) => ENABLED Begin
CanAdmit == (phase = "checking" /\ capability /\ connected /\
             requestPage = page /\ (snapshot = "default" \/ available))
            => ENABLED Admit
CanSend == (phase = "admitted" /\ connected) => ENABLED SendCloud
CanPlay == (phase \in {"admitted", "cloud"} /\ connected /\
            requestPage = page /\ (snapshot = "default" \/ available))
           => ENABLED Play
================================================================================
