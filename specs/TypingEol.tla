---- MODULE TypingEol ----------------------------------------------------------
(******************************************************************************)
(* Normalize CRLF input before planning chunks, then write each LF in the     *)
(* document's EOL. Model ordinary characters and LF/CRLF input units; lone   *)
(* carriage returns are outside this model. Both sides of the cursor follow  *)
(* the same conversion, and a resumed suffix is already normalized.          *)
(******************************************************************************)
EXTENDS Naturals, Sequences, PairDefs
CONSTANTS
    MaxUnits
Units == {<<Letter>>, <<LineFeed>>, <<CarriageReturn, LineFeed>>}
Inputs == Seqs(Units, MaxUnits)
RECURSIVE Flatten(_)
Flatten(units) ==
    IF units = <<>> THEN <<>> ELSE Head(units) \o Flatten(Tail(units))
RECURSIVE Normalize(_)
Normalize(chars) ==
    IF chars = <<>> THEN <<>>
    ELSE IF Len(chars) >= 2
         THEN IF Head(chars) = CarriageReturn /\ chars[2] = LineFeed
              THEN <<LineFeed>> \o Normalize(SubSeq(chars, 3, Len(chars)))
              ELSE <<Head(chars)>> \o Normalize(Tail(chars))
         ELSE chars
RECURSIVE Encode(_, _)
Encode(chars, ending) ==
    IF chars = <<>> THEN <<>>
    ELSE (IF Head(chars) = LineFeed THEN ending ELSE <<Head(chars)>>)
         \o Encode(Tail(chars), ending)
Canonical(units) ==
    [i \in 1..Len(units) |-> IF units[i] = <<Letter>> THEN Letter ELSE LineFeed]
CorrectEol ==
    \A u \in Inputs, e \in {<<LineFeed>>, <<CarriageReturn, LineFeed>>} :
    Encode(Normalize(Flatten(u)), e) = Encode(Canonical(u), e)
SuffixSafe == \A u \in Inputs : \A k \in 0..Len(u) :
    Normalize(Flatten(SubSeq(u, k + 1, Len(u)))) =
        SubSeq(Canonical(u), k + 1, Len(u))
\* A cursor may not divide the two characters of a CRLF input unit.
SplitOK(chars, k) ==
    IF k = 0 \/ k = Len(chars) THEN TRUE
    ELSE ~(chars[k] = CarriageReturn /\ chars[k + 1] = LineFeed)
NoSplitCRLF == \A u \in Inputs : \A k \in 0..Len(Flatten(u)) :
    SplitOK(Flatten(u), k) =>
        ~(k > 0 /\ k < Len(Flatten(u)) /\
          Flatten(u)[k] = CarriageReturn /\ Flatten(u)[k + 1] = LineFeed)
ASSUME CorrectEol
ASSUME SuffixSafe
ASSUME NoSplitCRLF
================================================================================
