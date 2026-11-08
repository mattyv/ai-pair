---- MODULE BuildIdentity ------------------------------------------------------
(******************************************************************************)
(* The panel identifies the running bundle, even when a new one is installed. *)
(******************************************************************************)
EXTENDS Naturals, FiniteSets
CONSTANTS Builds
ASSUME TwoBuilds == Cardinality(Builds) >= 2
VARIABLES installed, running, displayed
vars == <<installed, running, displayed>>

TypeOK == /\ installed \in Builds
          /\ running \in Builds
          /\ displayed \in Builds
Init == /\ installed \in Builds
        /\ running = installed
        /\ displayed = running
Install == /\ installed' \in Builds
           /\ UNCHANGED <<running, displayed>>
Reload == /\ running' = installed
          /\ displayed' = installed
          /\ UNCHANGED installed
Next == Install \/ Reload
Spec == Init /\ [][Next]_vars
ShowsRunning == displayed = running
ShowsNewAfterReload == [][Reload => displayed' = installed]_vars
================================================================================
