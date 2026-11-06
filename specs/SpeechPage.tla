---- MODULE SpeechPage ---------------------------------------------------------
(******************************************************************************)
(* Webview audio is bounded to the live unit and current page.                *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxId
ASSUME MaxId \in Nat \ {0}

VARIABLES page, nextId, current, playing, paused, copied
vars == <<page, nextId, current, playing, paused, copied>>

TypeOK == /\ page \in 1..2 /\ nextId \in 1..(MaxId + 1)
          /\ current \in 0..MaxId /\ playing \in 0..MaxId
          /\ paused \in BOOLEAN /\ copied \in BOOLEAN
Init == /\ page = 1 /\ nextId = 1 /\ current = 0 /\ playing = 0
        /\ paused = FALSE /\ copied = FALSE
Begin == /\ current = 0 /\ nextId <= MaxId
         /\ current' = nextId /\ nextId' = nextId + 1
         /\ playing' = 0 /\ copied' = FALSE /\ UNCHANGED <<page, paused>>
Audio(id, target) ==
    /\ id \in 1..MaxId /\ target \in 1..2
    /\ playing' = IF id = current /\ target = page /\ ~paused THEN id
                  ELSE playing
    /\ copied' = (id = current /\ target = page /\ ~paused)
    /\ UNCHANGED <<page, nextId, current, paused>>
Pause == /\ ~paused /\ paused' = TRUE /\ playing' = 0
         /\ copied' = FALSE /\ UNCHANGED <<page, nextId, current>>
Resume == /\ paused /\ paused' = FALSE /\ copied' = FALSE
          /\ UNCHANGED <<page, nextId, current, playing>>
Interrupt == /\ current # 0 /\ current' = 0 /\ playing' = 0
             /\ copied' = FALSE /\ UNCHANGED <<page, nextId, paused>>
Replace == /\ page' = IF page = 1 THEN 2 ELSE 1
           /\ current' = 0 /\ playing' = 0 /\ copied' = FALSE
           /\ UNCHANGED <<nextId, paused>>
Finish == /\ current # 0 /\ current' = 0 /\ playing' = 0
          /\ copied' = FALSE /\ UNCHANGED <<page, nextId, paused>>
Next == Begin \/ (\E id \in 1..MaxId, p \in 1..2 : Audio(id, p))
        \/ Pause \/ Resume \/ Interrupt \/ Replace \/ Finish
Spec == Init /\ [][Next]_vars
PlayingIsCurrent == playing # 0 => playing = current /\ ~paused
AcceptedStarts == copied => playing = current /\ current # 0 /\ ~paused
================================================================================
