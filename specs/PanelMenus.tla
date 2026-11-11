---- MODULE PanelMenus ---------------------------------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Menus
VARIABLES open, requested, clicks, closedAt
vars == <<open, requested, clicks, closedAt>>

Init == /\ open = {}
        /\ requested = "none"
        /\ clicks = 0
        /\ closedAt = 0

Open(menu) == /\ menu \in Menus
              /\ open' = {menu}
              /\ requested' = menu
              /\ clicks' = clicks + 1
              /\ UNCHANGED closedAt
Close == /\ open # {}
         /\ open' = {}
         /\ requested' = "none"
         /\ closedAt' = clicks
         /\ UNCHANGED clicks
Next == (\E menu \in Menus : Open(menu)) \/ Close
Spec == Init /\ [][Next]_vars

TypeOK == /\ open \subseteq Menus
          /\ requested \in Menus \cup {"none"}
          /\ clicks \in Nat
          /\ closedAt \in Nat

OneOpen == Cardinality(open) <= 1
RequestedVisible == requested # "none" => open = {requested}
ClosedWhenNone == requested = "none" => open = {}
ClickShows == clicks > closedAt => requested # "none"
Constraint == clicks <= 2
================================================================================
