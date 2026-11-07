---- MODULE OutputHandoff ------------------------------------------------------
(***************************************************************************
 * Browser retirement requires a matching page and job acknowledgement.   *
 * A worker-ready event may synthesize only after admission has succeeded.  *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardAdmission, GuardAck, GuardHandoff

VARIABLES request, phase, badWorker, browserId, browserPage, browserState,
          nativeBusy, badAck, timedOut
vars == <<request, phase, badWorker, browserId, browserPage, browserState,
          nativeBusy, badAck, timedOut>>

Init ==
    /\ request = 0 /\ phase = "idle" /\ badWorker = FALSE
    /\ browserId = 0 /\ browserPage = 0 /\ browserState = "idle"
    /\ nativeBusy = FALSE /\ badAck = FALSE /\ timedOut = FALSE

Begin ==
    /\ phase = "idle" /\ request < 2 /\ request' = request + 1
    /\ phase' = "admitting"
    /\ UNCHANGED <<badWorker, browserId, browserPage, browserState,
                   nativeBusy, badAck, timedOut>>

Admit ==
    /\ phase = "admitting" /\ phase' = "loading"
    /\ UNCHANGED <<request, badWorker, browserId, browserPage, browserState,
                   nativeBusy, badAck, timedOut>>

Ready ==
    /\ phase \in {"admitting", "loading"}
    /\ (~GuardAdmission \/ phase = "loading")
    /\ badWorker' = (badWorker \/ phase # "loading")
    /\ phase' = "synthesizing"
    /\ UNCHANGED <<request, browserId, browserPage, browserState,
                   nativeBusy, badAck, timedOut>>

Finish ==
    /\ phase # "idle" /\ phase' = "idle"
    /\ UNCHANGED <<request, badWorker, browserId, browserPage, browserState,
                   nativeBusy, badAck, timedOut>>

BrowserStart ==
    /\ browserState = "idle" /\ browserId < 2 /\ ~nativeBusy
    /\ browserId' = browserId + 1 /\ browserPage' \in 1..2
    /\ browserState' = "playing" /\ timedOut' = FALSE
    /\ UNCHANGED <<request, phase, badWorker, nativeBusy, badAck>>

BrowserStop ==
    /\ browserState = "playing" /\ browserState' = "retiring"
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   nativeBusy, badAck, timedOut>>

Ack(id, page) ==
    /\ browserState = "retiring" /\ id \in 1..2 /\ page \in 1..2
    /\ (~GuardAck \/ (id = browserId /\ page = browserPage))
    /\ badAck' = (badAck \/ id # browserId \/ page # browserPage)
    /\ browserState' = "idle"
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   nativeBusy, timedOut>>

PageClosed(page) ==
    /\ browserState \in {"playing", "retiring"} /\ page \in 1..2
    /\ (~GuardAck \/ page = browserPage)
    /\ badAck' = (badAck \/ page # browserPage)
    /\ browserState' = "idle"
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   nativeBusy, timedOut>>

Timeout ==
    /\ browserState = "retiring" /\ ~timedOut /\ timedOut' = TRUE
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   browserState, nativeBusy, badAck>>

NativeStart ==
    /\ ~nativeBusy /\ (~GuardHandoff \/ browserState = "idle")
    /\ nativeBusy' = TRUE
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   browserState, badAck, timedOut>>

NativeStop ==
    /\ nativeBusy /\ nativeBusy' = FALSE
    /\ UNCHANGED <<request, phase, badWorker, browserId, browserPage,
                   browserState, badAck, timedOut>>

Next == Begin \/ Admit \/ Ready \/ Finish \/ BrowserStart \/ BrowserStop
        \/ (\E id, page \in 1..2: Ack(id, page)) \/ Timeout
        \/ (\E page \in 1..2: PageClosed(page))
        \/ NativeStart \/ NativeStop
Spec == Init /\ [][Next]_vars /\ WF_vars(Timeout)
TypeOK ==
    /\ request \in 0..2 /\ phase \in {"idle", "admitting", "loading",
                                      "synthesizing"}
    /\ browserId \in 0..2 /\ browserPage \in 0..2
    /\ browserState \in {"idle", "playing", "retiring"}
    /\ badWorker \in BOOLEAN /\ nativeBusy \in BOOLEAN
    /\ badAck \in BOOLEAN /\ timedOut \in BOOLEAN
NoEarlyWorker == ~badWorker
NoStaleAck == ~badAck
NoCrossRouteOverlap == ~(nativeBusy /\ browserState # "idle")
CanBegin == (phase = "idle" /\ request < 2) => ENABLED Begin
CanReady == phase = "loading" => ENABLED Ready
CanAck == browserState = "retiring" => ENABLED Ack(browserId, browserPage)
CanClose == browserState # "idle" => ENABLED PageClosed(browserPage)
CanStartNative == (~nativeBusy /\ browserState = "idle") => ENABLED NativeStart
RetirementReported == (browserState = "retiring") ~>
                      (browserState = "idle" \/ timedOut)
================================================================================
