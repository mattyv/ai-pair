---- MODULE QuietTerminals -----------------------------------------------------
(******************************************************************************)
(* Visibility and cleanup of one terminal owned by AI Pair. An integrated    *)
(* foreground command is tracked; a fallback without shell integration      *)
(* remains untracked. Live shells are protected from cleanup because their   *)
(* background descendants are not observable. Revealed terminals are kept.  *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    Quiet, GuardCleanup

VARIABLES mode, visible, exposed, requested, cleanedBusy, beganQuiet
vars == <<mode, visible, exposed, requested, cleanedBusy, beganQuiet>>

TypeOK ==
    /\ mode \in {"idle", "running", "untracked", "exited", "closed"}
    /\ visible \in BOOLEAN
    /\ exposed \in BOOLEAN
    /\ requested \in BOOLEAN
    /\ cleanedBusy \in BOOLEAN
    /\ beganQuiet \in BOOLEAN

Init ==
    /\ mode = "idle"
    /\ visible = FALSE
    /\ exposed = FALSE
    /\ requested = FALSE
    /\ cleanedBusy = FALSE
    /\ beganQuiet = FALSE

Start ==
    /\ mode = "idle"
    /\ mode' = "running"
    /\ visible' = (visible \/ ~Quiet)
    /\ exposed' = (exposed \/ ~Quiet)
    /\ beganQuiet' = (Quiet /\ ~visible)
    /\ UNCHANGED <<requested, cleanedBusy>>

Reveal ==
    /\ mode # "closed"
    /\ visible' = TRUE
    /\ exposed' = TRUE
    /\ requested' = TRUE
    /\ beganQuiet' = FALSE
    /\ UNCHANGED <<mode, cleanedBusy>>

Fallback ==
    /\ mode = "running"
    /\ mode' = "untracked"
    /\ visible' = TRUE
    /\ exposed' = TRUE
    /\ beganQuiet' = FALSE
    /\ UNCHANGED <<requested, cleanedBusy>>

Finish ==
    /\ mode = "running"
    /\ mode' = "idle"
    /\ beganQuiet' = FALSE
    /\ UNCHANGED <<visible, exposed, requested, cleanedBusy>>

Exit ==
    /\ mode = "idle"
    /\ mode' = "exited"
    /\ UNCHANGED <<visible, exposed, requested, cleanedBusy, beganQuiet>>

Cleanup ==
    /\ mode # "closed"
    /\ ~GuardCleanup \/ (mode = "exited" /\ ~exposed)
    /\ cleanedBusy' = (cleanedBusy \/ mode # "exited" \/ exposed)
    /\ mode' = "closed"
    /\ beganQuiet' = FALSE
    /\ UNCHANGED <<visible, exposed, requested>>

Next == Start \/ Reveal \/ Fallback \/ Finish \/ Exit \/ Cleanup
Spec == Init /\ [][Next]_vars /\ WF_vars(Start)

NeverCloseProtected == ~cleanedBusy
FallbackVisible == mode = "untracked" => visible
RevealWorks == requested => visible
QuietStart == beganQuiet => ~visible
AutoStartVisible == (~Quiet /\ mode = "running") => visible
RunBegins == (mode = "idle") ~>
    (mode = "running" \/ mode = "exited" \/ mode = "closed")
================================================================================
