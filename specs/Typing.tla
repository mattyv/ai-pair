---- MODULE Typing -------------------------------------------------------------
(******************************************************************************)
(* How planTyping in packages/core/src/typing.ts splits text into chunks,     *)
(* each inserted in one edit, checked over every small text. Delays aren't    *)
(* modeled: only the splitting. Two quote kinds are distinct from the other  *)
(* characters named in PairDefs. The chunks of a plan concatenate to the      *)
(* input text.                                                                *)
(******************************************************************************)
EXTENDS Naturals, Sequences, PairDefs

CONSTANTS
    MaxChars  \* the longest text the check covers

ASSUME AssumeMaxChars == MaxChars \in Nat

--------------------------------------------------------------------------------

\* The characters: any other, a space or tab, and a line feed.
Quotes == {"singleQuote", "doubleQuote"}
Chars == {Letter, Space, LineFeed} \cup Quotes

\* Every text up to MaxChars characters.
Texts == Seqs(Chars, MaxChars)

AllSpaces(c) == \A i \in 1..Len(c) : c[i] = Space

\* `cs` without its first `n` characters.
Drop(cs, n) == SubSeq(cs, n + 1, Len(cs))

\* The indentation at the start of `cs` (takeIndent). The CHOOSE takes the
\* length of the run of spaces `cs` starts with; exactly one length is that.
IndentOf(cs) ==
    LET n == CHOOSE k \in 0..Len(cs) :
                 /\ AllSpaces(SubSeq(cs, 1, k))
                 /\ (k = Len(cs) \/ cs[k + 1] # Space)
    IN  SubSeq(cs, 1, n)

\* The longest initial run of the same quote character.
QuoteRun(cs) ==
    LET n == CHOOSE k \in 1..Len(cs) :
                 /\ \A i \in 1..k : cs[i] = Head(cs)
                 /\ (k = Len(cs) \/ cs[k + 1] # Head(cs))
    IN SubSeq(cs, 1, n)

\* The loop: a line feed goes with the indentation after it; anything else
\* goes alone. A function over the finite set Texts (6.16); each step recurs
\* on a shorter text, so it ends.
Chunks[cs \in Texts] ==
    IF cs = <<>>
    THEN <<>>
    ELSE IF Head(cs) = LineFeed
         THEN LET indent == IndentOf(Tail(cs))
              IN  <<<<LineFeed>> \o indent>> \o Chunks[Drop(Tail(cs),
                                                            Len(indent))]
         ELSE IF Head(cs) \in Quotes /\ Len(QuoteRun(cs)) >= 3
              THEN LET run == QuoteRun(cs)
                   IN <<run>> \o Chunks[Drop(cs, Len(run))]
         ELSE <<<<Head(cs)>>>> \o Chunks[Tail(cs)]

\* With atLineStart, indentation at the very start is one chunk first.
Plan(cs, atLineStart) ==
    LET indent == IndentOf(cs)
    IN  IF atLineStart /\ indent # <<>>
        THEN <<indent>> \o Chunks[Drop(cs, Len(indent))]
        ELSE Chunks[cs]

\* The chunks joined into one text. An operator, not a function: a sequence
\* of chunks has no finite set to be a function's domain (6.16). Each call is
\* on a shorter sequence, so it ends.
RECURSIVE Concat(_)
Concat(chunks) ==
    IF chunks = <<>> THEN <<>> ELSE Head(chunks) \o Concat(Tail(chunks))

--------------------------------------------------------------------------------

\* The chunks concatenate to the text. A planner that typed nothing would
\* fail it, so it says something must happen.
ConcatenatesToText == \A t \in Texts, s \in BOOLEAN : Concat(Plan(t, s)) = t

\* Each chunk is one character that isn't a line feed, a line feed with the
\* indentation after it, or (first, at a line's start) the indentation there;
\* none is empty.
ChunksAreUnits ==
    \A t \in Texts, s \in BOOLEAN :
        LET p == Plan(t, s)
        IN  \A i \in 1..Len(p) :
                \/ Len(p[i]) = 1 /\ p[i][1] # LineFeed
                \/ p[i][1] = LineFeed /\ AllSpaces(Tail(p[i]))
                \/ p[i][1] \in Quotes /\ Len(p[i]) >= 3 /\
                   (\A j \in 1..Len(p[i]) : p[i][j] = p[i][1])
                \/ i = 1 /\ s /\ p[i] # <<>> /\ AllSpaces(p[i])

\* A run of three or more identical quotes is never split across edits.
QuoteRunsAtomic ==
    \A t \in Texts, s \in BOOLEAN :
        LET p == Plan(t, s)
        IN \A i \in 1..(Len(p) - 1) :
             (p[i][1] \in Quotes /\ p[i + 1][1] = p[i][1]) =>
               /\ Len(p[i]) = 1 /\ Len(p[i + 1]) = 1
               /\ (IF i = 1 THEN TRUE ELSE p[i - 1][1] # p[i][1])
               /\ (IF i + 1 = Len(p) THEN TRUE
                   ELSE p[i + 2][1] # p[i][1])

ASSUME AssumeConcatenatesToText == ConcatenatesToText
ASSUME AssumeChunksAreUnits == ChunksAreUnits
ASSUME AssumeQuoteRunsAtomic == QuoteRunsAtomic

================================================================================
