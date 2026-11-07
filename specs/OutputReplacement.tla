---- MODULE OutputReplacement --------------------------------------------------
(***************************************************************************
 * Replacing a view is not evidence its old browser audio has stopped.     *
 * Only matching disposal may release ownership; unavailable native output *
 * can be refused immediately while ownership remains.                      *
 ***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardReplacement, GuardDisposal

VARIABLES currentPage, ownerPage, browser, native, refused, badRelease
vars == <<currentPage, ownerPage, browser, native, refused, badRelease>>

Init ==
    /\ currentPage = 1 /\ ownerPage = 0 /\ browser = "idle"
    /\ native = FALSE /\ refused = FALSE /\ badRelease = FALSE

BrowserStart ==
    /\ browser = "idle" /\ ~native /\ browser' = "active"
    /\ ownerPage' = currentPage /\ refused' = FALSE
    /\ UNCHANGED <<currentPage, native, badRelease>>

Replace ==
    /\ currentPage = 1 /\ currentPage' = 2
    /\ browser' = IF GuardReplacement THEN browser ELSE "idle"
    /\ badRelease' = (badRelease \/ (~GuardReplacement /\ browser # "idle"))
    /\ UNCHANGED <<ownerPage, native, refused>>

Dispose(page) ==
    /\ page \in 1..2 /\ browser = "active"
    /\ (~GuardDisposal \/ page = ownerPage)
    /\ browser' = "idle"
    /\ badRelease' = (badRelease \/ page # ownerPage)
    /\ UNCHANGED <<currentPage, ownerPage, native, refused>>

Refuse ==
    /\ browser = "active" /\ ~native /\ ~refused /\ refused' = TRUE
    /\ UNCHANGED <<currentPage, ownerPage, browser, native, badRelease>>

NativeStart ==
    /\ browser = "idle" /\ ~native /\ native' = TRUE
    /\ UNCHANGED <<currentPage, ownerPage, browser, refused, badRelease>>

NativeStop ==
    /\ native /\ native' = FALSE
    /\ UNCHANGED <<currentPage, ownerPage, browser, refused, badRelease>>

Next == BrowserStart \/ Replace \/ (\E page \in 1..2: Dispose(page))
        \/ Refuse \/ NativeStart \/ NativeStop
Spec == Init /\ [][Next]_vars
TypeOK ==
    /\ currentPage \in 1..2 /\ ownerPage \in 0..2
    /\ browser \in {"idle", "active"} /\ native \in BOOLEAN
    /\ refused \in BOOLEAN /\ badRelease \in BOOLEAN
NoPrematureRelease == ~badRelease
NoOverlap == ~(native /\ browser = "active")
CanRefuse == (browser = "active" /\ ~refused) => ENABLED Refuse
CanDispose == browser = "active" => ENABLED Dispose(ownerPage)
CanStart == (browser = "idle" /\ ~native) => ENABLED NativeStart
================================================================================
