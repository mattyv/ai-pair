---- MODULE CommandEncoding ----------------------------------------------------
EXTENDS Naturals

CONSTANTS ExactEncode, ScopeBash, GuardMultiline, GuardSubshell
Chars == {"letter", "quote", "slash", "newline", "control", "unicode"}
VARIABLES shell, kind, hasNul, original, submitted, approved, changed, wrapped
vars == <<shell, kind, hasNul, original, submitted, approved, changed, wrapped>>
NeedsWrap == kind \in {"multiline", "subshell"}
Chosen == (kind = "multiline" /\ GuardMultiline) \/
          (kind = "subshell" /\ GuardSubshell)
ShouldWrap == shell = "bash" /\ NeedsWrap /\ ~hasNul
Init == /\ shell \in {"bash", "other", "unknown"}
        /\ kind \in {"plain", "multiline", "subshell"}
        /\ hasNul \in BOOLEAN /\ original \in Chars
        /\ submitted = "none" /\ approved = original /\ changed = FALSE
        /\ wrapped = FALSE
Submit == /\ submitted = "none"
          /\ submitted' = IF (shell = "bash" \/ ~ScopeBash) /\ Chosen /\ ~hasNul
                          THEN IF ExactEncode THEN original ELSE "corrupt"
                          ELSE original
          /\ wrapped' = ((shell = "bash" \/ ~ScopeBash) /\ Chosen /\ ~hasNul)
          /\ changed' = (changed \/ (approved # original))
          /\ UNCHANGED <<shell, kind, hasNul, original, approved>>
Next == Submit
Spec == Init /\ [][Next]_vars /\ WF_vars(Submit)
TypeOK == /\ shell \in {"bash", "other", "unknown"}
          /\ kind \in {"plain", "multiline", "subshell"}
          /\ hasNul \in BOOLEAN /\ original \in Chars
          /\ submitted \in Chars \cup {"none"} /\ approved \in Chars
          /\ changed \in BOOLEAN /\ wrapped \in BOOLEAN
PayloadPreserved == submitted = "none" \/ submitted = original
ApprovalPreserved == ~changed
ScopeBashOnly == shell # "bash" => ~wrapped
RequiredWrapping == submitted # "none" => (wrapped <=> ShouldWrap)
EventuallySubmitted == submitted = "none" ~> submitted # "none"
================================================================================
