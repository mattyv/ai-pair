---- MODULE CommandDelivery ---------------------------------------------------
EXTENDS Naturals, FiniteSets

\* A bounded queue and atomic report consumption. The interrupted head must
\* settle before any call returns; command results wake listens and empty steps.
CONSTANT NoCall
VARIABLES queue, call, news, delivered, produced, interrupted
vars == <<queue, call, news, delivered, produced, interrupted>>

Init == /\ queue = 2 /\ call = NoCall /\ news = 0
        /\ delivered = 0 /\ produced = 0 /\ interrupted = FALSE
Call(k) == /\ call = NoCall /\ call' = k
           /\ UNCHANGED <<queue, news, delivered, produced, interrupted>>
FinishRun == /\ queue > 0 /\ queue' = queue - 1 /\ news' = news + 1 /\ produced' = produced + 1
             /\ interrupted' = FALSE /\ UNCHANGED <<call, delivered>>
FinishQuiet == /\ queue > 0 /\ queue' = queue - 1 /\ interrupted' = FALSE
               /\ UNCHANGED <<call, news, delivered, produced>>
Interrupt == /\ queue > 0 /\ ~interrupted /\ interrupted' = TRUE
             /\ UNCHANGED <<queue, call, news, delivered, produced>>
Ready == ~interrupted /\ (CASE call = "listen" -> news > 0
                            [] call = "empty" -> news > 0 \/ queue = 0
                            [] call = "step" -> queue < 2
                            [] call = "discarded" -> queue = 0
                            [] call = "end" -> queue = 0
                            [] OTHER -> FALSE)
Return == /\ Ready /\ call' = NoCall /\ delivered' = delivered + news
          /\ news' = 0 /\ UNCHANGED <<queue, produced, interrupted>>
Next == \/ \E k \in {"listen", "empty", "step", "discarded", "end"}: Call(k)
        \/ FinishRun \/ FinishQuiet \/ Interrupt \/ Return
Spec == Init /\ [][Next]_vars /\ WF_vars(Return) /\ WF_vars(FinishQuiet)
TypeOK == /\ queue \in 0..2 /\ news \in 0..2 /\ delivered \in 0..2
          /\ produced \in 0..2
          /\ call \in {NoCall, "listen", "empty", "step", "discarded", "end"} /\ interrupted \in BOOLEAN
Conservation == produced = news + delivered
PromptRunReady == (call \in {"listen", "empty"} /\ news > 0 /\ ~interrupted) => Ready
NoEarlyDiscarded == (call = "discarded" /\ queue > 0) => ~Ready
NoEarlyEnd == (call = "end" /\ queue > 0) => ~Ready
NoQuietWake == (call = "listen" /\ news = 0) => ~Ready
NoInterruptedReturn == interrupted => ~Ready
RunDelivered == (call \in {"listen", "empty"} /\ news > 0 /\ ~interrupted) ~> news = 0
=============================================================================
