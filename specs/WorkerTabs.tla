---- MODULE WorkerTabs ---------------------------------------------------------
EXTENDS Naturals

\* The tab row and selection follow the split-agent setting. This abstracts
\* rendering and retained tab content, not the worker's edit authority.
CONSTANTS GuardDefault, GuardVisible, GuardSelect, GuardDisable
VARIABLES enabled, selected, rowVisible, badDefault
vars == <<enabled, selected, rowVisible, badDefault>>

Init ==
    /\ enabled = ~GuardDefault
    /\ selected = "pair"
    /\ rowVisible = ~GuardDefault
    /\ badDefault = enabled

Enable ==
    /\ ~enabled
    /\ enabled' = TRUE
    /\ rowVisible' = TRUE
    /\ UNCHANGED <<selected, badDefault>>

Disable ==
    /\ enabled
    /\ enabled' = FALSE
    /\ rowVisible' = ~GuardVisible
    /\ selected' = IF GuardDisable THEN "pair" ELSE selected
    /\ UNCHANGED badDefault

Select(tab) ==
    /\ tab \in {"pair", "worker"}
    /\ GuardSelect => (tab = "pair" \/ enabled)
    /\ selected' = tab
    /\ UNCHANGED <<enabled, rowVisible, badDefault>>

Next == Enable \/ Disable \/ (\E tab \in {"pair", "worker"}: Select(tab))
Spec == Init /\ [][Next]_vars
TypeOK == /\ enabled \in BOOLEAN /\ rowVisible \in BOOLEAN
          /\ selected \in {"pair", "worker"} /\ badDefault \in BOOLEAN
DefaultOff == ~badDefault
RowMatchesSetting == rowVisible = enabled
WorkerOnlyEnabled == selected = "worker" => enabled
================================================================================
