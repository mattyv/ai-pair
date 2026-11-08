---- MODULE SettingsAccess -----------------------------------------------------
(******************************************************************************)
(* The toolbar offers one settings control in every panel state.             *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS ShowWhenIdle
ASSUME IsBoolean == ShowWhenIdle \in BOOLEAN
VARIABLES active, calibrating, gearCount
vars == <<active, calibrating, gearCount>>
TypeOK == /\ active \in BOOLEAN /\ calibrating \in BOOLEAN
          /\ gearCount \in 0..1
Count(a, c) == IF a \/ c \/ ShowWhenIdle THEN 1 ELSE 0
Init == /\ active = FALSE /\ calibrating = FALSE
        /\ gearCount = Count(active, calibrating)
Change == /\ active' \in BOOLEAN /\ calibrating' \in BOOLEAN
          /\ gearCount' = Count(active', calibrating')
Next == Change
Spec == Init /\ [][Next]_vars
SettingsAvailable == gearCount = 1
================================================================================
