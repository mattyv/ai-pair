---- MODULE StructuralTyping ---------------------------------------------------
(******************************************************************************)
(* The opt-in structural newline and step past one adjacent close.           *)
(* Language and lexical context are abstracted to supported and code.        *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Open, Close, Other, Inner, Outer
ASSUME Distinct == Cardinality({Open, Close, Other, Inner, Outer}) = 5

VARIABLES left, right, supported, code, selection, action, changed,
          eligibleNewline, eligibleStep, moved, originalRight
vars == <<left, right, supported, code, selection, action, changed,
          eligibleNewline, eligibleStep, moved, originalRight>>

TypeOK ==
    /\ left \in {Open, Close, Other, Inner}
    /\ right \in {<<Close>>, <<Close, Close>>, <<Other>>,
                  <<Outer, Close>>, <<Outer, Close, Close>>}
    /\ supported \in BOOLEAN
    /\ code \in BOOLEAN
    /\ selection \in BOOLEAN
    /\ action \in {"none", "newline", "step"}
    /\ changed \in BOOLEAN
    /\ eligibleNewline \in BOOLEAN
    /\ eligibleStep \in BOOLEAN
    /\ moved \in 0..1
    /\ originalRight \in {<<Close>>, <<Close, Close>>, <<Other>>}

Init ==
    /\ left \in {Open, Other}
    /\ right \in {<<Close>>, <<Close, Close>>, <<Other>>}
    /\ supported \in BOOLEAN
    /\ code \in BOOLEAN
    /\ selection \in BOOLEAN
    /\ eligibleNewline = (supported /\ code /\ ~selection /\ left = Open /\
                          Head(right) = Close)
    /\ eligibleStep = (~selection /\ Head(right) = Close)
    /\ originalRight = right
    /\ action = "none"
    /\ changed = FALSE
    /\ moved = 0

SmartNewline ==
    /\ action = "none"
    /\ action' = "newline"
    /\ IF supported /\ code /\ ~selection /\ left = Open /\
          Head(right) = Close
       THEN /\ left' = Inner
            /\ right' = <<Outer>> \o right
            /\ changed' = TRUE
       ELSE /\ UNCHANGED <<left, right, changed>>
    /\ UNCHANGED <<supported, code, selection, eligibleNewline, eligibleStep,
                   moved, originalRight>>

StepClose ==
    /\ action = "none"
    /\ action' = "step"
    /\ IF Head(right) = Close /\ ~selection
       THEN /\ moved' = 1
            /\ changed' = TRUE
       ELSE /\ UNCHANGED <<moved, changed>>
    /\ UNCHANGED <<left, right, supported, code, selection, eligibleNewline,
                   eligibleStep, originalRight>>

Next == SmartNewline \/ StepClose
Spec == Init /\ [][Next]_vars

NewlineSafe == (action = "newline" /\ changed) =>
    (eligibleNewline /\ left = Inner /\ right = <<Outer>> \o originalRight)
NewlineActs == (action = "newline" /\ eligibleNewline) => changed
StepOne == (action = "step" /\ changed) =>
    (eligibleStep /\ moved = 1 /\ right = originalRight)
StepActs == (action = "step" /\ eligibleStep) => changed
RefusalSafe == ((action = "newline" /\ ~eligibleNewline) \/
                (action = "step" /\ ~eligibleStep)) => ~changed
================================================================================
