---- MODULE LocalAudioOwnership ------------------------------------------------
(***************************************************************************
 * A local audio owner, two jobs, page and connection epochs, and lease.   *
 * Network loss is detected later, not assumed to stop audio instantly.    *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardAck, GuardControl, GuardHeartbeat, GuardParent, GuardNatural

VARIABLES job, page, jobPage, connection, jobConnection, sequence,
          ackSequence, phase,
          live, ownerAlive, wireUp, detected, canceled, badAck, badControl,
          badHeartbeat, badEnded
vars == <<job, page, jobPage, connection, jobConnection, sequence,
          ackSequence, phase,
          live, ownerAlive, wireUp, detected, canceled, badAck, badControl,
          badHeartbeat, badEnded>>

Init ==
    /\ job = 0 /\ page = 0 /\ jobPage = 0
    /\ connection = 0 /\ jobConnection = 0 /\ sequence = 0
    /\ ackSequence = 0
    /\ phase = "idle" /\ live = FALSE /\ ownerAlive = TRUE /\ wireUp = TRUE
    /\ detected = FALSE /\ canceled = FALSE /\ badAck = FALSE
    /\ badControl = FALSE /\ badHeartbeat = FALSE /\ badEnded = FALSE

Begin ==
    /\ phase = "idle" /\ ~live /\ ownerAlive /\ wireUp /\ job < 2
    /\ job' = job + 1 /\ jobPage' = page /\ jobConnection' = connection
    /\ phase' = "starting" /\ live' = TRUE /\ canceled' = FALSE
    /\ UNCHANGED <<page, connection, sequence, ownerAlive, wireUp, detected,
                   badAck, badControl, badHeartbeat, badEnded, ackSequence>>

Fresh(j, p, e, n) ==
    /\ j = job /\ p = jobPage /\ e = connection /\ e = jobConnection
    /\ n > sequence /\ wireUp /\ ownerAlive

FreshAck(j, p, e, n) ==
    /\ j = job /\ p = jobPage /\ e = jobConnection /\ e = connection
    /\ n > ackSequence /\ wireUp /\ ownerAlive

LocalFresh(j, p, e) == j = job /\ p = jobPage /\ e = jobConnection

Started(j, p, e, n) ==
    /\ j \in 1..2 /\ p \in 0..1 /\ e \in 0..1 /\ n \in 1..3
    /\ phase = "starting" \/ (~GuardAck /\ phase = "retiring")
    /\ (~GuardAck \/ FreshAck(j, p, e, n))
    /\ badAck' = (badAck \/ ~FreshAck(j, p, e, n) \/ phase # "starting")
    /\ ackSequence' = n /\ phase' = "playing"

    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   live,
                   ownerAlive, wireUp, detected, canceled, badControl,
                   badHeartbeat, badEnded>>

Control(kind, j, p, e, n) ==
    /\ kind \in {"pause", "resume"} /\ j \in 1..2 /\ p \in 0..1
    /\ e \in 0..1 /\ n \in 1..3
    /\ (kind = "pause" /\ phase = "playing") \/
       (kind = "resume" /\ phase = "paused")
    /\ (~GuardControl \/ Fresh(j, p, e, n))
    /\ badControl' = (badControl \/ ~Fresh(j, p, e, n)) /\ sequence' = n
    /\ phase' = IF kind = "pause" THEN "paused" ELSE "playing"
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, live,
                   ownerAlive, wireUp, detected, canceled, badAck,
                   badHeartbeat, badEnded, ackSequence>>

Heartbeat(e, n) ==
    /\ e \in 0..1 /\ n \in 1..3
    /\ (~GuardHeartbeat \/ (wireUp /\ ownerAlive /\ e = connection /\
                            n > sequence))
    /\ badHeartbeat' = (badHeartbeat \/ ~wireUp \/ ~ownerAlive \/
                        e # connection \/ n <= sequence)
    /\ sequence' = n

    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, phase, live,
                   ownerAlive,
                   wireUp, detected, canceled, badAck, badControl, badEnded,
          ackSequence>>

Cancel ==
    /\ live /\ phase # "retiring" /\ phase' = "retiring" /\ canceled' = TRUE
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   live, ownerAlive, wireUp, detected, badAck, badControl,
                   badHeartbeat, badEnded, ackSequence>>

PageChange ==
    /\ page < 1 /\ page' = page + 1
    /\ phase' = IF live THEN "retiring" ELSE phase
    /\ canceled' = (canceled \/ live)
    /\ UNCHANGED <<job, jobPage, connection, jobConnection, sequence,
                   live,
                   ownerAlive, wireUp, detected, badAck, badControl,
                   badHeartbeat, badEnded, ackSequence>>

WireLoss ==
    /\ wireUp /\ wireUp' = FALSE
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   phase, live, ownerAlive, detected, canceled, badAck,
                   badControl, badHeartbeat, badEnded, ackSequence>>

LeaseExpired ==
    /\ ~wireUp /\ live /\ ~detected /\ detected' = TRUE
    /\ phase' = "retiring" /\ canceled' = TRUE
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   live, ownerAlive, wireUp, badAck, badControl, badHeartbeat,
                   badEnded, ackSequence>>

DeviceLost ==
    /\ live /\ phase # "retiring" /\ phase' = "retiring" /\ canceled' = TRUE
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   live, ownerAlive, wireUp, detected, badAck, badControl,
                   badHeartbeat, badEnded, ackSequence>>

Retired(j, p, e) ==
    /\ j \in 1..2 /\ p \in 0..1 /\ e \in 0..1
    /\ live /\ phase = "retiring"
    /\ (~GuardAck \/ LocalFresh(j, p, e))
    /\ badAck' = (badAck \/ ~LocalFresh(j, p, e))
    /\ live' = FALSE /\ phase' = "idle"
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   ownerAlive, wireUp, detected, canceled, badControl,
                   badHeartbeat, badEnded, ackSequence>>

NaturalEnd(j, p, e) ==
    /\ j \in 1..2 /\ p \in 0..1 /\ e \in 0..1
    /\ (~GuardAck \/ LocalFresh(j, p, e))
    /\ badAck' = (badAck \/ ~LocalFresh(j, p, e))
    /\ live /\ (phase = "playing" \/ (~GuardNatural /\ phase = "retiring"))
    /\ live' = FALSE /\ phase' = "idle"
    /\ badEnded' = (badEnded \/ canceled)
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   ownerAlive, wireUp, detected, canceled, badControl,
                   badHeartbeat, ackSequence>>

ParentDied ==
    /\ ownerAlive /\ ownerAlive' = FALSE
    /\ phase' = IF GuardParent /\ live THEN "retiring" ELSE phase
    /\ canceled' = IF GuardParent /\ live THEN TRUE ELSE canceled
    /\ UNCHANGED <<job, page, jobPage, connection, jobConnection, sequence,
                   live, wireUp, detected, badAck, badControl, badHeartbeat,
                   badEnded, ackSequence>>

Reconnect ==
    /\ ~wireUp /\ ~live /\ ownerAlive /\ connection < 1
    /\ connection' = connection + 1 /\ wireUp' = TRUE /\ sequence' = 0
    /\ ackSequence' = 0
    /\ detected' = FALSE
    /\ UNCHANGED <<job, page, jobPage, jobConnection, phase, live,
                   ownerAlive,
                   canceled, badAck, badControl, badHeartbeat, badEnded>>

Next == Begin \/ (\E j \in 1..2, p \in 0..1, e \in 0..1, n \in 1..3:
                 Started(j, p, e, n) \/
                 (\E kind \in {"pause", "resume"}: Control(kind, j, p, e, n)))
        \/ (\E e \in 0..1, n \in 1..3: Heartbeat(e, n))
        \/ Cancel \/ PageChange \/ WireLoss \/ LeaseExpired
        \/ (\E j \in 1..2, p \in 0..1, e \in 0..1:
            Retired(j, p, e) \/ NaturalEnd(j, p, e))
        \/ DeviceLost \/ ParentDied \/ Reconnect
Spec == Init /\ [][Next]_vars /\ WF_vars(LeaseExpired)
    /\ WF_vars(\E j \in 1..2, p \in 0..1, e \in 0..1: Retired(j, p, e))
TypeOK ==
    /\ job \in 0..2 /\ page \in 0..1 /\ jobPage \in 0..1
    /\ connection \in 0..1 /\ jobConnection \in 0..1 /\ sequence \in 0..3
    /\ ackSequence \in 0..3
    /\ phase \in {"idle", "starting", "playing", "paused", "retiring"}
    /\ live \in BOOLEAN /\ ownerAlive \in BOOLEAN /\ wireUp \in BOOLEAN
    /\ detected \in BOOLEAN /\ canceled \in BOOLEAN /\ badAck \in BOOLEAN
    /\ badControl \in BOOLEAN /\ badHeartbeat \in BOOLEAN
    /\ badEnded \in BOOLEAN
NoStaleAck == ~badAck
NoStaleControl == ~badControl
NoStaleHeartbeat == ~badHeartbeat
NoOrphan == ownerAlive \/ ~live \/ phase = "retiring"
NoCanceledEnd == ~badEnded
NoRevival == phase = "playing" => ~canceled
NoOverlap == (phase = "idle") => ~live
CanStart == (phase = "idle" /\ ~live /\ ownerAlive /\ wireUp /\ job < 2)
            => ENABLED Begin
CanAcknowledge ==
    (phase = "starting" /\ wireUp /\ ownerAlive /\ ackSequence < 3) =>
    ENABLED Started(job, jobPage, jobConnection, ackSequence + 1)
LeaseStops == (~wireUp /\ live) ~> ~live
RetirementStops == (phase = "retiring") ~> ~live
ParentLossSettles == (~ownerAlive /\ live) ~> ~live
================================================================================
