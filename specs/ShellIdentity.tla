---- MODULE ShellIdentity ------------------------------------------------------
EXTENDS Naturals
CONSTANTS WaitForIdentity, WaitForSubshell
VARIABLES shell, kind, hasNul, phase, submitted, wrapped, expired, stopped
vars == <<shell, kind, hasNul, phase, submitted, wrapped, expired, stopped>>
NeedsWrap == kind \in {"multiline", "subshell"}
MustWait == (kind = "multiline" /\ WaitForIdentity) \/
            (kind = "subshell" /\ WaitForSubshell)
Init == /\ shell \in {"unknown", "bash", "other"}
        /\ kind \in {"plain", "multiline", "subshell"}
        /\ hasNul \in BOOLEAN
        /\ phase = "idle" /\ submitted = FALSE
        /\ wrapped = FALSE /\ expired = FALSE /\ stopped = FALSE
Start == /\ phase = "idle"
         /\ phase' = IF shell = "unknown" /\ MustWait
                     THEN "waiting" ELSE "ready"
         /\ UNCHANGED <<shell, kind, hasNul, submitted, wrapped, expired,
                        stopped>>
Identify == /\ phase = "waiting"
            /\ shell' \in {"bash", "other"} /\ phase' = "ready"
            /\ UNCHANGED <<kind, hasNul, submitted, wrapped, expired, stopped>>
Expire == /\ phase = "waiting" /\ phase' = "ready" /\ expired' = TRUE
          /\ UNCHANGED <<shell, kind, hasNul, submitted, wrapped, stopped>>
Abort == /\ phase \in {"idle", "waiting", "ready"}
         /\ phase' = "aborted" /\ stopped' = TRUE
         /\ UNCHANGED <<shell, kind, hasNul, submitted, wrapped, expired>>
Close == /\ phase \in {"idle", "waiting", "ready"}
         /\ phase' = "closed" /\ stopped' = TRUE
         /\ UNCHANGED <<shell, kind, hasNul, submitted, wrapped, expired>>
Submit == /\ phase = "ready" /\ phase' = "submitted" /\ submitted' = TRUE
          /\ wrapped' = (shell = "bash" /\ NeedsWrap /\ ~hasNul)
          /\ UNCHANGED <<shell, kind, hasNul, expired, stopped>>
Next == Start \/ Identify \/ Expire \/ Abort \/ Close \/ Submit
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Expire)
        /\ WF_vars(Submit)
TypeOK == /\ shell \in {"unknown", "bash", "other"}
          /\ kind \in {"plain", "multiline", "subshell"}
          /\ hasNul \in BOOLEAN
          /\ phase \in {"idle", "waiting", "ready", "aborted", "closed",
                        "submitted"}
          /\ submitted \in BOOLEAN /\ wrapped \in BOOLEAN
          /\ expired \in BOOLEAN /\ stopped \in BOOLEAN
WaitBeforeUnknown == (submitted /\ NeedsWrap) => (shell # "unknown" \/ expired)
WrapOnlyBash == wrapped <=>
                (submitted /\ shell = "bash" /\ NeedsWrap /\ ~hasNul)
NoSubmitAfterStop == stopped => ~submitted
EventuallySettled == phase = "idle" ~>
                     phase \in {"submitted", "aborted", "closed"}
================================================================================
