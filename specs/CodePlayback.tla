---- MODULE CodePlayback -------------------------------------------------------
(****************************************************************************)
(* Grouping existing atomic typing chunks and reading each inserted group.   *)
(* An atom represents one existing edit, including protected quote runs and *)
(* newline with indentation. A model group is a nonempty contiguous prefix. *)
(****************************************************************************)
EXTENDS Naturals, Sequences, TLC

CONSTANTS A, B, C, MaxGroup, MaxWidth, MaxLines, MaxId
Atoms == <<A, B, C>>
Widths == <<1, 2, 5>>
Lines == <<0, 1, 0>>

RECURSIVE Sum(_, _, _)
Sum(values, start, count) ==
    IF count = 0 THEN 0 ELSE values[start] + Sum(values, start + 1, count - 1)

Bounded(start, count) ==
    \/ /\ Sum(Widths, start, count) <= MaxWidth
       /\ Sum(Lines, start, count) <= MaxLines
    \/ /\ count = 1
       /\ (Widths[start] > MaxWidth \/ Lines[start] > MaxLines)
ASSUME Assumptions == /\ Atoms # <<>> /\ MaxGroup \in Nat \ {0}
                      /\ MaxId \in Nat \ {0} /\ MaxWidth \in Nat \ {0}
                      /\ MaxLines \in Nat \ {0}

VARIABLES pos, inserted, reading, nextId, paused, interrupted, clicked,
          clickId, beforeReading, beforePaused, accepted
vars == <<pos, inserted, reading, nextId, paused, interrupted, clicked,
          clickId, beforeReading, beforePaused, accepted>>

Init == /\ pos = 0 /\ inserted = <<>> /\ reading = 0 /\ nextId = 1
        /\ paused = FALSE /\ interrupted = FALSE /\ clicked = FALSE
        /\ clickId = 0 /\ beforeReading = 0 /\ beforePaused = FALSE
        /\ accepted = FALSE

Insert(n) ==
    /\ ~paused /\ ~interrupted /\ reading = 0 /\ pos < Len(Atoms)
    /\ n \in 1..(IF MaxGroup < Len(Atoms) - pos THEN MaxGroup ELSE Len(Atoms) - pos) /\ nextId <= MaxId
    /\ Bounded(pos + 1, n)
    /\ inserted' = inserted \o SubSeq(Atoms, pos + 1, pos + n)
    /\ pos' = pos + n /\ reading' = nextId /\ nextId' = nextId + 1
    /\ clicked' = FALSE /\ accepted' = FALSE
    /\ UNCHANGED <<paused, interrupted, clickId, beforeReading, beforePaused>>

TogglePause == /\ paused' = ~paused /\ clicked' = FALSE /\ accepted' = FALSE
    /\ UNCHANGED <<pos, inserted, reading, nextId, interrupted, clickId,
                   beforeReading, beforePaused>>

Finish == /\ reading # 0 /\ ~paused /\ reading' = 0
    /\ clicked' = FALSE /\ accepted' = FALSE
    /\ UNCHANGED <<pos, inserted, nextId, paused, interrupted, clickId,
                   beforeReading, beforePaused>>

Click(id) == /\ id \in 1..MaxId /\ clicked' = TRUE /\ clickId' = id
    /\ beforeReading' = reading /\ beforePaused' = paused
    /\ accepted' = (id = reading /\ reading # 0 /\ ~paused /\ ~interrupted)
    /\ reading' = (IF accepted' THEN 0 ELSE reading)
    /\ UNCHANGED <<pos, inserted, nextId, paused, interrupted>>

Interrupt == /\ ~interrupted /\ interrupted' = TRUE /\ reading' = 0
    /\ clicked' = FALSE /\ accepted' = FALSE
    /\ UNCHANGED <<pos, inserted, nextId, paused, clickId,
                   beforeReading, beforePaused>>

Next == (\E n \in 1..MaxGroup : Insert(n)) \/ TogglePause \/ Finish
        \/ (\E id \in 1..MaxId : Click(id)) \/ Interrupt
Spec == Init /\ [][Next]_vars
ProgressNext == (\E n \in 1..MaxGroup : Insert(n)) \/ Finish
ProgressSpec == Init /\ [][ProgressNext]_vars /\ WF_vars(ProgressNext)
EventuallyComplete == <> (pos = Len(Atoms))

TypeOK == /\ pos \in 0..Len(Atoms) /\ reading \in 0..MaxId
          /\ nextId \in 1..(MaxId + 1) /\ paused \in BOOLEAN
          /\ interrupted \in BOOLEAN
PrefixExact == inserted = SubSeq(Atoms, 1, pos)
CurrentCountdown == accepted => /\ clicked /\ clickId = beforeReading
    /\ beforeReading # 0 /\ ~beforePaused /\ reading = 0
RejectedKeepsCountdown == clicked /\ ~accepted => reading = beforeReading
Completed == pos = Len(Atoms) => inserted = Atoms
PausedBlocksInsert == [][paused => pos' = pos]_vars
ReadingBlocksInsert == [][reading # 0 => pos' = pos]_vars
InterruptedBlocksInsert == [][interrupted => pos' = pos]_vars
BoundedGroups == [][pos' > pos => Bounded(pos + 1, pos' - pos)]_vars
=============================================================================
