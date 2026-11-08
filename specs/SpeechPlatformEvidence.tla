---- MODULE SpeechPlatformEvidence ---------------------------------------------
EXTENDS Naturals

CONSTANTS GuardEvidence, EnableCheck, EnablePositive
VARIABLES phase, platform, report, fallback, supported
vars == <<phase, platform, report, fallback, supported>>

Init ==
    /\ phase = "idle" /\ platform = "unknown" /\ report = "unknown"
    /\ fallback = "unknown" /\ supported = FALSE

Check ==
    /\ EnableCheck /\ phase = "idle"
    /\ \E p \in {"linux-x64", "other"},
           r \in {"positive", "missing", "failed"},
           f \in {"positive", "negative", "failed"}:
        /\ platform' = p /\ report' = r /\ fallback' = f
        /\ supported' = (EnablePositive /\ p = "linux-x64" /\
             (r = "positive" \/ f = "positive" \/ ~GuardEvidence))
        /\ phase' = "checked"

Next == Check
Spec == Init /\ [][Next]_vars /\ WF_vars(Check)
TypeOK ==
    /\ phase \in {"idle", "checked"}
    /\ platform \in {"unknown", "linux-x64", "other"}
    /\ report \in {"unknown", "positive", "missing", "failed"}
    /\ fallback \in {"unknown", "positive", "negative", "failed"}
    /\ supported \in BOOLEAN
PositiveEvidence == supported =>
    (platform = "linux-x64" /\ (report = "positive" \/ fallback = "positive"))
RecognizesEvidence == (phase = "checked" /\ platform = "linux-x64" /\
    (report = "positive" \/ fallback = "positive")) => supported
CheckCompletes == (phase = "idle") ~> (phase = "checked")
================================================================================
