---- MODULE SpeechPlatformEvidence ---------------------------------------------
EXTENDS Naturals

\* Platforms are classes of `<platform>-<arch>` hosts (#39): Linux x64
\* ("linux-kokoro"); macOS on x64 or arm64 ("nonlinux-kokoro"); Linux or macOS
\* on another architecture ("kokoro-os-other-arch"); and any other operating
\* system ("other").
\* GuardArch: FALSE models a check that accepts any architecture.
\* EnableNonLinux: FALSE models the Linux-only check this spec replaced.
CONSTANTS GuardEvidence, EnableCheck, EnablePositive, GuardArch, EnableNonLinux
VARIABLES phase, platform, report, fallback, supported
vars == <<phase, platform, report, fallback, supported>>

Platforms ==
    {"linux-kokoro", "nonlinux-kokoro", "kokoro-os-other-arch", "other"}

\* Linux needs positive GNU libc evidence; macOS has one system C runtime, so
\* its platform and architecture are the whole check.
LinuxEvidence(p, r, f) ==
    p = "linux-kokoro" /\ (r = "positive" \/ f = "positive" \/ ~GuardEvidence)
NonLinuxAccepted(p) ==
    /\ EnableNonLinux
    /\ \/ p = "nonlinux-kokoro"
       \/ ~GuardArch /\ p = "kokoro-os-other-arch"

Init ==
    /\ phase = "idle" /\ platform = "unknown" /\ report = "unknown"
    /\ fallback = "unknown" /\ supported = FALSE

Check ==
    /\ EnableCheck /\ phase = "idle"
    /\ \E p \in Platforms,
           r \in {"positive", "missing", "failed"},
           f \in {"positive", "negative", "failed"}:
        /\ platform' = p /\ report' = r /\ fallback' = f
        /\ supported' = (EnablePositive /\
             (LinuxEvidence(p, r, f) \/ NonLinuxAccepted(p)))
        /\ phase' = "checked"

Next == Check
Spec == Init /\ [][Next]_vars /\ WF_vars(Check)
TypeOK ==
    /\ phase \in {"idle", "checked"}
    /\ platform \in {"unknown"} \cup Platforms
    /\ report \in {"unknown", "positive", "missing", "failed"}
    /\ fallback \in {"unknown", "positive", "negative", "failed"}
    /\ supported \in BOOLEAN
PositiveEvidence == supported =>
    \/ /\ platform = "linux-kokoro"
       /\ (report = "positive" \/ fallback = "positive")
    \/ platform = "nonlinux-kokoro"
RecognizesEvidence == (phase = "checked" /\
    (\/ /\ platform = "linux-kokoro"
        /\ (report = "positive" \/ fallback = "positive")
     \/ platform = "nonlinux-kokoro")) => supported
CheckCompletes == (phase = "idle") ~> (phase = "checked")
================================================================================
