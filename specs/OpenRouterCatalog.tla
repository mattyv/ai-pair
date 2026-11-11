---- MODULE OpenRouterCatalog --------------------------------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS MaxEpoch, GuardStale, GuardDenied, EnableAdmission, KeepOnRefresh
VARIABLES epoch, pending, eligibility, evidenceEpoch, admitted,
          admissionEvidence
vars == <<epoch, pending, eligibility, evidenceEpoch, admitted,
          admissionEvidence>>

TypeOK == /\ epoch \in 0..MaxEpoch /\ pending \subseteq 1..MaxEpoch
          /\ eligibility \in {"unknown", "allowed", "denied"}
          /\ evidenceEpoch \in 0..MaxEpoch
          /\ admitted \in BOOLEAN
          /\ admissionEvidence \in {"none", "unknown", "allowed", "denied"}
Init == /\ epoch = 0 /\ pending = {} /\ eligibility = "unknown"
        /\ evidenceEpoch = 0 /\ admitted = FALSE
        /\ admissionEvidence = "none"

Load == /\ epoch < MaxEpoch /\ epoch' = epoch + 1
        /\ pending' = pending \cup {epoch'}
        /\ eligibility' = IF KeepOnRefresh THEN eligibility ELSE "unknown"
        /\ evidenceEpoch' = epoch'
        /\ UNCHANGED <<admitted, admissionEvidence>>
Reset == /\ epoch < MaxEpoch /\ epoch' = epoch + 1
         /\ eligibility' = "unknown" /\ evidenceEpoch' = epoch'
         /\ UNCHANGED <<pending, admitted, admissionEvidence>>
Reply == \E request \in pending:
           /\ pending' = pending \ {request}
           /\ IF request = epoch \/ ~GuardStale
                 THEN /\ eligibility' \in {"allowed", "denied", eligibility}
                      /\ evidenceEpoch' = request
                 ELSE /\ UNCHANGED <<eligibility, evidenceEpoch>>
           /\ UNCHANGED <<epoch, admitted, admissionEvidence>>
Admit == /\ EnableAdmission /\ ~admitted
         /\ (eligibility # "denied" \/ ~GuardDenied)
         /\ admitted' = TRUE /\ admissionEvidence' = eligibility
         /\ UNCHANGED <<epoch, pending, eligibility, evidenceEpoch>>
Next == Load \/ Reset \/ Reply \/ Admit
Spec == Init /\ [][Next]_vars /\ WF_vars(Admit)
CatalogStale == evidenceEpoch = epoch
CatalogEligibility == admitted => admissionEvidence # "denied"
CatalogProgress == ~admitted /\ eligibility # "denied" => ENABLED Admit
StableProgress == (<>[](eligibility # "denied")) => <>admitted
DeniedRefresh == [][eligibility = "denied" /\ Load =>
                     eligibility' = "denied"]_vars
================================================================================
