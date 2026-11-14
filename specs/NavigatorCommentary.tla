---- MODULE NavigatorCommentary ------------------------------------------------
EXTENDS Naturals

CONSTANTS FreshProjection, RestoreOldMode, WakeOnChange, PreserveEvidence,
          GuardRestore, MaxChanges
VARIABLES mode, desired, call, report, delivered, restored, stale, evidence,
          lost, pending, gen, reportGen, missed, session, changes, wrongRestore
vars == <<mode, desired, call, report, delivered, restored, stale, evidence,
          lost, pending, gen, reportGen, missed, session, changes,
          wrongRestore>>
Modes == {"quiet", "helpful", "coach"}
Init == /\ mode = "helpful" /\ desired = "helpful"
        /\ call = "none" /\ report = "none" /\ delivered = "none"
        /\ restored = FALSE /\ stale = FALSE /\ evidence = TRUE
        /\ lost = FALSE /\ pending = FALSE /\ gen = 0 /\ reportGen = 0
        /\ missed = FALSE /\ session = TRUE /\ changes = 0
        /\ wrongRestore = FALSE
SetMode(m) == /\ m \in Modes /\ mode' = m /\ desired' = m
              /\ IF m # mode /\ session
                 THEN /\ pending' = TRUE /\ gen' = gen + 1
                      /\ changes' = changes + 1
                 ELSE UNCHANGED <<pending, gen, changes>>
              /\ UNCHANGED <<call, report, delivered, restored, stale,
                             evidence, lost, reportGen, missed, session,
                             wrongRestore>>
Start == /\ session /\ call = "none" /\ call' = "pending"
         /\ UNCHANGED <<mode, desired, report, delivered, restored, stale,
                        evidence, lost, pending, gen, reportGen, missed,
                        session, changes, wrongRestore>>
Notice == /\ call = "pending" /\ pending
          /\ call' = IF WakeOnChange THEN "committed" ELSE "pending"
          /\ missed' = (missed \/ ~WakeOnChange)
          /\ report' = mode
          /\ reportGen' = IF restored THEN reportGen ELSE gen
          /\ pending' = FALSE
          /\ evidence' = IF PreserveEvidence THEN evidence ELSE FALSE
          /\ lost' = (lost \/ (evidence /\ ~PreserveEvidence))
          /\ UNCHANGED <<mode, desired, delivered, restored, stale, gen,
                         session, changes, wrongRestore>>
Commit == /\ call = "pending" /\ ~pending
          /\ call' = "committed" /\ report' = mode /\ reportGen' = 0
          /\ UNCHANGED <<mode, desired, delivered, restored, stale, evidence,
                         lost, pending, gen, missed, session, changes,
                         wrongRestore>>
Deliver == /\ call = "committed" /\ call' = "none"
           /\ delivered' = IF FreshProjection THEN mode ELSE report
           /\ stale' = (stale \/
                ((IF FreshProjection THEN mode ELSE report) # mode))
           /\ restored' = FALSE
           /\ UNCHANGED <<mode, desired, report, evidence, lost, pending, gen,
                          reportGen, missed, session, changes, wrongRestore>>
Cancel == /\ call = "committed" /\ call' = "none" /\ restored' = TRUE
          /\ UNCHANGED <<mode, desired, report, delivered, stale, evidence,
                         lost, pending, gen, reportGen, missed, session,
                         changes, wrongRestore>>
Restore == /\ restored /\ session /\ call = "none"
           /\ restored' = FALSE
           /\ pending' = IF reportGen # 0 /\
                (IF GuardRestore THEN reportGen = gen ELSE TRUE)
                THEN TRUE ELSE pending
           /\ wrongRestore' = (wrongRestore \/
                (reportGen # 0 /\ reportGen # gen /\ ~pending /\ ~GuardRestore))
           /\ mode' = IF RestoreOldMode THEN report ELSE mode
           /\ UNCHANGED <<desired, call, report, delivered, stale, evidence,
                          lost, gen, reportGen, missed, session, changes>>
End == /\ session /\ session' = FALSE /\ call' = "none" /\ restored' = FALSE
       /\ pending' = FALSE
       /\ UNCHANGED <<mode, desired, report, delivered, stale, evidence, lost,
                      gen, reportGen, missed, changes, wrongRestore>>
Next == (\E m \in Modes: SetMode(m)) \/ Start \/ Notice \/ Commit \/ Deliver
        \/ Cancel \/ Restore \/ End
Spec == Init /\ [][Next]_vars /\ WF_vars(Notice) /\ WF_vars(Commit)
        /\ WF_vars(Deliver)
TypeOK == /\ mode \in Modes /\ desired \in Modes
          /\ call \in {"none", "pending", "committed"}
          /\ report \in Modes \cup {"none"} /\ delivered \in Modes \cup {"none"}
          /\ restored \in BOOLEAN /\ stale \in BOOLEAN /\ evidence \in BOOLEAN
          /\ lost \in BOOLEAN /\ pending \in BOOLEAN /\ missed \in BOOLEAN
          /\ session \in BOOLEAN /\ gen \in Nat /\ reportGen \in Nat
          /\ changes \in Nat /\ wrongRestore \in BOOLEAN
CurrentAtDelivery == ~stale
RestoreKeepsMode == mode = desired
EvidencePreserved == ~lost
ChangedWake == ~missed
NoOldRestore == ~wrongRestore
EventuallySettled == call # "none" ~> call = "none"
Constraint == changes <= MaxChanges
================================================================================
