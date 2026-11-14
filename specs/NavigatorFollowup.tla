---- MODULE NavigatorFollowup --------------------------------------------------
EXTENDS Naturals

CONSTANTS PreserveQueue, PreserveBaseline, VisibleOnly, CheckCurrent
Files == {"a", "b"}
Texts == {0, 1}
VARIABLES baseline, current, pending, ready, queue, seen, actual, wrong,
          wake, observed, badWake, expected
vars == <<baseline, current, pending, ready, queue, seen, actual, wrong,
          wake, observed, badWake, expected>>
Init == /\ baseline = [f \in Files |-> 0]
        /\ current = baseline /\ pending = {}
        /\ ready = FALSE /\ queue = TRUE
        /\ seen = {} /\ actual = {} /\ wrong = FALSE /\ wake = FALSE
        /\ observed = FALSE /\ badWake = FALSE /\ expected = FALSE
Edit(f) == /\ current' = [current EXCEPT ![f] = 1 - @]
           /\ pending' = pending \cup {f}
           /\ ready' = FALSE
           /\ UNCHANGED <<baseline, queue, seen, actual, wrong, wake, observed,
                          badWake, expected>>
Timeout == /\ pending # {}
           /\ pending' = {}
           /\ observed' = (observed \/
                (PreserveBaseline /\
                 (\E f \in Files: current[f] # baseline[f])))
           /\ expected' = (expected \/
                (\E f \in Files: current[f] # baseline[f]))
           /\ baseline' = current
           /\ UNCHANGED <<current, ready, queue, seen, actual, wrong, wake,
                          badWake>>
Fire == /\ ~ready
        /\ ready' = TRUE
        /\ wake' = (observed \/ (\E f \in Files: current[f] # baseline[f]))
        /\ badWake' = (wake' #
              (expected \/ (\E f \in Files: current[f] # baseline[f])))
        /\ UNCHANGED <<baseline, current, pending, queue, seen, actual, wrong,
                       observed, expected>>
HandBack == /\ queue
            /\ queue' = IF PreserveQueue THEN queue ELSE FALSE
            /\ UNCHANGED <<baseline, current, pending, ready, seen, actual,
                           wrong, wake, observed, badWake, expected>>
Show(visible, currentText) == /\ visible \subseteq Files
                 /\ seen' = (IF (CheckCurrent /\ ~currentText) THEN {}
                             ELSE IF VisibleOnly THEN visible ELSE Files)
                 /\ actual' = (IF currentText THEN visible ELSE {})
                 /\ UNCHANGED <<baseline, current, pending, ready, queue,
                                wrong, wake, observed, badWake, expected>>
Accept(f) == /\ f \in seen
             /\ wrong' = (wrong \/ (f \notin actual))
             /\ UNCHANGED <<baseline, current, pending, ready, queue, seen,
                            actual, wake, observed, badWake, expected>>
ConsumePause == /\ ready
                /\ ready' = FALSE /\ observed' = FALSE
                /\ expected' = FALSE
                /\ baseline' = current /\ pending' = {}
                /\ UNCHANGED <<current, queue, seen, actual, wrong, wake,
                               badWake>>
Next == ConsumePause \/ (\E f \in Files: Edit(f) \/ Accept(f))
        \/ Timeout \/ Fire \/ HandBack
        \/ (\E visible \in SUBSET Files, currentText \in BOOLEAN:
                Show(visible, currentText))
Spec == Init /\ [][Next]_vars /\ WF_vars(Fire)
TypeOK == /\ baseline \in [Files -> Texts] /\ current \in [Files -> Texts]
          /\ pending \subseteq Files /\ seen \subseteq Files
          /\ actual \subseteq Files /\ ready \in BOOLEAN /\ queue \in BOOLEAN
          /\ wrong \in BOOLEAN /\ wake \in BOOLEAN
          /\ observed \in BOOLEAN /\ badWake \in BOOLEAN
          /\ expected \in BOOLEAN
VisibleLinesOnly == ~wrong
QueuePreserved == queue
WakeMatches == ~badWake
EventuallyReady == ~ready ~> ready
================================================================================
