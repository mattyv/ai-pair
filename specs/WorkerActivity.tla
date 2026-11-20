---- MODULE WorkerActivity -----------------------------------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxId
VARIABLES history, active, ownerActive, visibility, inline, view, confirming

vars == <<history, active, ownerActive, visibility, inline, view, confirming>>
Phases == {"started", "editing", "progress", "batchDone",
           "completed", "stopped"}
Modes == {"milestones", "everything", "off"}

Init ==
    /\ history = <<>>
    /\ active = {}
    /\ ownerActive = {}
    /\ visibility = "milestones"
    /\ inline = <<>>
    /\ view = "pair"
    /\ confirming = FALSE

Publish(id, phase) ==
    /\ id \in 1..MaxId /\ phase \in Phases
    /\ history' = Append(history, <<id, phase>>)
    /\ active' = IF phase = "started" THEN active \cup {id}
                 ELSE IF phase \in {"completed", "stopped"} THEN active \ {id}
                 ELSE active
    /\ ownerActive' = IF phase = "started" THEN ownerActive \cup {id}
                      ELSE IF phase \in {"completed", "stopped"}
                           THEN ownerActive \ {id}
                      ELSE ownerActive
    /\ inline' = IF visibility = "everything" \/
                    (visibility = "milestones" /\
                     phase \notin {"editing", "progress"})
                  THEN Append(inline, <<id, phase>>) ELSE inline
    /\ UNCHANGED <<visibility, view, confirming>>

SetVisibility(mode) ==
    /\ mode \in Modes /\ visibility' = mode
    /\ UNCHANGED <<history, active, ownerActive, inline, view, confirming>>
Reload ==
    /\ active' = {}
    /\ UNCHANGED <<history, ownerActive, visibility, inline, view, confirming>>
Snapshot ==
    /\ active' = ownerActive
    /\ UNCHANGED <<history, ownerActive, visibility, inline, view, confirming>>
Restart ==
    /\ active' = {} /\ ownerActive' = {}
    /\ UNCHANGED <<history, visibility, inline, view, confirming>>
SelectWorker ==
    /\ ~confirming /\ view' = "worker"
    /\ UNCHANGED <<history, active, ownerActive, visibility, inline,
                   confirming>>
Resolve ==
    /\ confirming' = FALSE
    /\ UNCHANGED <<history, active, ownerActive, visibility, inline, view>>
Confirm ==
    /\ confirming' = TRUE /\ view' = "pair"
    /\ UNCHANGED <<history, active, ownerActive, visibility, inline>>
Next ==
    \/ Resolve \/ SelectWorker \/ Confirm \/ Reload \/ Snapshot \/ Restart
    \/ \E id \in 1..MaxId, phase \in Phases : Publish(id, phase)
    \/ \E mode \in Modes : SetVisibility(mode)
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ active \subseteq 1..MaxId /\ ownerActive \subseteq 1..MaxId
    /\ visibility \in Modes
    /\ history \in Seq((1..MaxId) \X Phases)
    /\ inline \in Seq((1..MaxId) \X Phases)
ActiveOwned == active \subseteq ownerActive
ConfirmVisible == confirming => view = "pair"
InlineRecorded ==
    \A i \in 1..Len(inline) : inline[i] \in {history[j] : j \in 1..Len(history)}
ActiveRecorded ==
    \A id \in active :
        <<id, "started">> \in {history[j] : j \in 1..Len(history)}
Constraint == Len(history) <= 3
================================================================================
